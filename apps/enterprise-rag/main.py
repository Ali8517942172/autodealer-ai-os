"""
AutoDealer Enterprise RAG - Multi-Agent Knowledge Assistant
======================================================

Retrieval-Augmented Generation system for automotive dealerships.
Retrieves real policy documents from Supabase and generates grounded,
cited answers using an OpenRouter LLM call (real generation, not canned
demo responses).

Architecture:
    FastAPI -> Agent Router -> Supabase (rag_documents table, lexical retrieval)
                            -> OpenRouter LLM (answer synthesis with citations)
"""

import os
import uuid
import time
from typing import List, Optional
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_ANON_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# ==========================================
# Models
# ==========================================

class QueryRequest(BaseModel):
    question: str
    agent: Optional[str] = "openclaw"
    top_k: Optional[int] = 3

class QueryResponse(BaseModel):
    answer: str
    sources: List[dict]
    agent_used: str
    query_id: str
    processing_time_ms: float

class HealthResponse(BaseModel):
    status: str
    service: str
    agents_available: List[str]
    vector_store: str
    documents_indexed: int

# ==========================================
# Agent Definitions
# ==========================================

AGENTS = {
    "openclaw": {
        "name": "Openclaw",
        "role": "Compliance & Policy Agent",
        "system_prompt": "You are Openclaw, the compliance and policy AI agent for AutoDealer Cars dealership. Answer using ONLY the provided document excerpts. Always cite the source document and page number. If the excerpts don't contain the answer, say so honestly rather than guessing."
    },
    "hermes": {
        "name": "Hermes",
        "role": "Marketing Intelligence Agent",
        "system_prompt": "You are Hermes, the marketing intelligence AI agent for AutoDealer Cars, focused on UAE automotive market competitor analysis and pricing strategy."
    },
    "cowork": {
        "name": "Cowork",
        "role": "Sales Support Agent",
        "system_prompt": "You are Cowork, the sales support AI agent for AutoDealer Cars, helping staff with vehicle specs, financing, and trade-in questions."
    }
}


def get_document_count() -> int:
    if not supabase:
        return 0
    try:
        res = supabase.table("rag_documents").select("id", count="exact").execute()
        return res.count or 0
    except Exception:
        return 0


def retrieve_relevant_docs(question: str, top_k: int = 3) -> List[dict]:
    """
    Real lexical retrieval against the live Supabase rag_documents table.
    Scores documents by keyword overlap between the question and content,
    then returns the top_k highest-scoring real document rows.
    """
    if not supabase:
        return []

    try:
        res = supabase.table("rag_documents").select("*").execute()
        docs = res.data or []
    except Exception as e:
        print(f"[RAG] Supabase fetch error: {e}")
        return []

    q_words = {w.lower() for w in question.split() if len(w) > 3}
    scored = []
    for doc in docs:
        content_lower = (doc.get("content") or "").lower()
        title_lower = (doc.get("doc_title") or "").lower()
        section_lower = (doc.get("section") or "").lower()
        score = sum(1 for w in q_words if w in content_lower)
        score += sum(2 for w in q_words if w in title_lower or w in section_lower)
        if score > 0:
            scored.append((score, doc))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in scored[:top_k]]


async def generate_answer(question: str, agent_key: str, docs: List[dict]) -> str:
    """Real LLM call to OpenRouter, grounded in the retrieved document excerpts."""
    agent = AGENTS.get(agent_key, AGENTS["openclaw"])

    if not docs:
        return "I couldn't find any indexed document covering this question. Please ask about warranty coverage, leave policy, sales commission, or trade-in appraisal process — or upload the relevant document."

    context = "\n\n".join([
        f"[Source: {d.get('doc_title')} — {d.get('section')}, {d.get('source_file')}, page {d.get('page_number')}]\n{d.get('content')}"
        for d in docs
    ])

    if not OPENROUTER_API_KEY:
        # No LLM key configured — return the real retrieved excerpts directly (still not canned/demo)
        return "Based on our indexed policy documents:\n\n" + context

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "google/gemma-4-31b-it:free",
                    "messages": [
                        {"role": "system", "content": agent["system_prompt"]},
                        {"role": "user", "content": f"Document excerpts:\n\n{context}\n\nQuestion: {question}\n\nAnswer clearly and cite the source document + page for each claim."}
                    ]
                }
            )
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[RAG] OpenRouter call failed: {e}")
        return "Based on our indexed policy documents:\n\n" + context


# ==========================================
# FastAPI Application
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Enterprise RAG] Connecting to Supabase knowledge base...")
    print(f"[Enterprise RAG] Indexed documents: {get_document_count()}")
    yield
    print("[Enterprise RAG] Shutting down...")

app = FastAPI(
    title="AutoDealer Enterprise RAG API",
    description="Multi-Agent Knowledge Assistant for Automotive Dealerships",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# Endpoints
# ==========================================

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="OK",
        service="AutoDealer Enterprise RAG",
        agents_available=list(AGENTS.keys()),
        vector_store="Supabase (lexical retrieval)",
        documents_indexed=get_document_count()
    )

@app.get("/api/agents")
async def list_agents():
    return [{"id": k, "name": v["name"], "role": v["role"]} for k, v in AGENTS.items()]

@app.post("/api/query", response_model=QueryResponse)
async def query_knowledge(request: QueryRequest):
    """
    Query the real Supabase knowledge base:
    1. Retrieves relevant document rows from Supabase (live, not hardcoded)
    2. Sends them as grounding context to an OpenRouter LLM
    3. Returns a cited answer from real document content
    """
    start_time = time.time()

    agent = AGENTS.get(request.agent)
    if not agent:
        raise HTTPException(status_code=400, detail=f"Agent '{request.agent}' not found. Available: {list(AGENTS.keys())}")

    docs = retrieve_relevant_docs(request.question, request.top_k or 3)
    answer = await generate_answer(request.question, request.agent, docs)

    sources = [
        {
            "title": d.get("doc_title"),
            "section": d.get("section"),
            "source_file": d.get("source_file"),
            "page": d.get("page_number")
        }
        for d in docs
    ]

    processing_time = (time.time() - start_time) * 1000

    return QueryResponse(
        answer=answer,
        sources=sources,
        agent_used=agent["name"],
        query_id=str(uuid.uuid4()),
        processing_time_ms=round(processing_time, 2)
    )

@app.get("/api/documents")
async def list_documents():
    """List all real documents indexed in Supabase."""
    if not supabase:
        return []
    try:
        res = supabase.table("rag_documents").select("id,doc_title,section,source_file,page_number").execute()
        return res.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# Entry Point
# ==========================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5002, reload=True)
