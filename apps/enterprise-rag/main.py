"""
NEXUS OS Enterprise RAG - Multi-Agent Knowledge Assistant
======================================================

Retrieval-Augmented Generation system for automotive dealerships.
Retrieves real policy documents from Supabase using pgvector (semantic search)
and generates grounded, cited answers using an OpenRouter LLM call.

Architecture:
    FastAPI -> Agent Router -> Supabase (rag_documents table, pgvector)
                            -> OpenRouter LLM (answer synthesis with citations)
"""

import os
import uuid
import time
from typing import List, Optional
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")  # Used for generating embeddings

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_ANON_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

security = HTTPBearer()

def get_supabase_client(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Client:
    """Creates a request-scoped Supabase client with the user's JWT to enforce RLS."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        from supabase import ClientOptions
        options = ClientOptions(headers={"Authorization": f"Bearer {credentials.credentials}"})
        return create_client(SUPABASE_URL, SUPABASE_ANON_KEY, options=options)
    except ImportError:
        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        client.postgrest.auth(credentials.credentials)
        return client

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

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = Field(default_factory=list)
    agent: Optional[str] = "openclaw"
    top_k: Optional[int] = 3

class ChatResponse(BaseModel):
    reply: str
    sources: List[dict]
    agent_used: str
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
        "system_prompt": "You are Openclaw, the compliance and policy AI agent for NEXUS OS Cars dealership. Answer using ONLY the provided document excerpts. Always cite the source document and page number. If the excerpts don't contain the answer, say so honestly rather than guessing."
    },
    "hermes": {
        "name": "Hermes",
        "role": "Marketing Intelligence Agent",
        "system_prompt": "You are Hermes, the marketing intelligence AI agent for NEXUS OS Cars, focused on UAE automotive market competitor analysis and pricing strategy."
    },
    "cowork": {
        "name": "Cowork",
        "role": "Sales Support Agent",
        "system_prompt": "You are Cowork, the sales support AI agent for NEXUS OS Cars, helping staff with vehicle specs, financing, and trade-in questions."
    }
}

# ==========================================
# Services
# ==========================================

async def get_embedding(text: str) -> List[float]:
    """Generate embedding for the input text using OpenAI's embedding model."""
    if not OPENAI_API_KEY:
        print("[RAG] Warning: OPENAI_API_KEY not set, using mock embeddings.")
        return [0.0] * 1536  # Default dimension for text-embedding-3-small

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "input": text,
                    "model": "text-embedding-3-small"
                }
            )
            resp.raise_for_status()
            data = resp.json()
            return data["data"][0]["embedding"]
    except Exception as e:
        print(f"[RAG] Embedding generation failed: {e}")
        return [0.0] * 1536


async def retrieve_relevant_docs(supabase_client: Client, question: str, top_k: int = 3) -> List[dict]:
    """
    Semantic retrieval against Supabase pgvector using the match_documents RPC.
    Securely uses the request-scoped client to enforce Row Level Security (RLS).
    """
    if not supabase_client:
        return []

    try:
        # Generate embedding for the question
        query_embedding = await get_embedding(question)

        # Call Supabase pgvector RPC
        # The RPC function 'match_documents' should be defined in Supabase:
        # match_documents(query_embedding vector(1536), match_threshold float, match_count int)
        res = supabase_client.rpc("match_documents", {
            "query_embedding": query_embedding,
            "match_threshold": 0.2,  # Adjust based on required precision
            "match_count": top_k
        }).execute()
        
        docs = res.data or []
        return docs
    except Exception as e:
        print(f"[RAG] Supabase pgvector error: {e}")
        # Securely fail rather than falling back to fetching all documents
        raise HTTPException(status_code=500, detail="Failed to retrieve context securely from pgvector.")


def get_document_count() -> int:
    if not supabase:
        return 0
    try:
        res = supabase.table("rag_documents").select("id", count="exact").execute()
        return res.count or 0
    except Exception:
        return 0


async def generate_answer(question: str, agent_key: str, docs: List[dict], history: Optional[List[ChatMessage]] = None) -> str:
    """Real LLM call to OpenRouter, grounded in the retrieved document excerpts."""
    agent = AGENTS.get(agent_key, AGENTS["openclaw"])

    if not docs:
        return "I couldn't find any indexed document covering this question. Please ask about warranty coverage, leave policy, sales commission, or trade-in appraisal process — or upload the relevant document."

    context = "\n\n".join([
        f"[Source: {d.get('doc_title')} — {d.get('section')}, {d.get('source_file')}, page {d.get('page_number')}]\n{d.get('content')}"
        for d in docs
    ])

    if not OPENROUTER_API_KEY:
        return "Based on our indexed policy documents:\n\n" + context

    messages = [{"role": "system", "content": agent["system_prompt"]}]
    
    if history:
        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})

    user_content = f"Document excerpts:\n\n{context}\n\nQuestion: {question}\n\nAnswer clearly and cite the source document + page for each claim."
    messages.append({"role": "user", "content": user_content})

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "google/gemma-2-9b-it:free", # Updated from gemma-4-31b-it:free which does not exist
                    "messages": messages
                }
            )
            resp.raise_for_status()
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
    title="NEXUS OS Enterprise RAG API",
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
        service="NEXUS OS Enterprise RAG",
        agents_available=list(AGENTS.keys()),
        vector_store="Supabase pgvector (semantic search)",
        documents_indexed=get_document_count()
    )

@app.get("/api/agents")
async def list_agents():
    return [{"id": k, "name": v["name"], "role": v["role"]} for k, v in AGENTS.items()]

@app.post("/api/query", response_model=QueryResponse)
async def query_knowledge(request: QueryRequest, supabase_client: Client = Depends(get_supabase_client)):
    """Legacy single-turn query endpoint using pgvector."""
    start_time = time.time()

    agent = AGENTS.get(request.agent)
    if not agent:
        raise HTTPException(status_code=400, detail=f"Agent '{request.agent}' not found.")

    docs = await retrieve_relevant_docs(supabase_client, request.question, request.top_k or 3)
    answer = await generate_answer(request.question, request.agent, docs)

    sources = [
        {
            "title": d.get("doc_title"),
            "section": d.get("section"),
            "source_file": d.get("source_file"),
            "page": d.get("page_number"),
            "similarity": round(d.get("similarity", 0.0), 3) if "similarity" in d else None
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

@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest, supabase_client: Client = Depends(get_supabase_client)):
    """
    Multi-turn chat endpoint for the Dashboard 'Ask AI' feature.
    Maintains conversation context and retrieves relevant documents via pgvector.
    """
    start_time = time.time()
    
    agent = AGENTS.get(request.agent)
    if not agent:
        raise HTTPException(status_code=400, detail=f"Agent '{request.agent}' not found.")

    # Retrieve docs via semantic search (pgvector) securely enforcing RLS
    docs = await retrieve_relevant_docs(supabase_client, request.message, request.top_k or 3)
    
    # Generate answer with history
    reply = await generate_answer(request.message, request.agent, docs, request.history)

    sources = [
        {
            "title": d.get("doc_title"),
            "section": d.get("section"),
            "source_file": d.get("source_file"),
            "page": d.get("page_number"),
            "similarity": round(d.get("similarity", 0.0), 3) if "similarity" in d else None
        }
        for d in docs
    ]

    processing_time = (time.time() - start_time) * 1000

    return ChatResponse(
        reply=reply,
        sources=sources,
        agent_used=agent["name"],
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
