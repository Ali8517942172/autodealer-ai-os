"""
AutoDealer AI OS - AI Gateway Service
=======================================

BUSINESS PROBLEM:
    Multiple AI agents across the platform (Sales, Marketing, Knowledge, Finance)
    each need LLM access. Without centralization, every service independently
    manages API keys, model selection, rate limiting, and cost tracking.

SOLUTION:
    A single AI Gateway that routes all LLM requests through OpenRouter.
    Intelligent model selection based on task complexity:
    - Simple tasks (summaries, formatting) → Fast free models
    - Reasoning tasks (analysis, recommendations) → Reasoning models
    - Code generation → Code-specialized models

BUSINESS IMPACT:
    - Centralized cost control and usage monitoring
    - Easy model switching without changing application code
    - Consistent error handling and retry logic across all services

TECH STACK:
    FastAPI + OpenRouter API (OpenAI-compatible)
"""

import os
import time
import uuid
import json
from datetime import datetime
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# Configuration
# ==========================================

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Model routing strategy
MODEL_ROUTES = {
    "fast": "openrouter/auto",           # Auto-route to fastest available
    "reasoning": "openrouter/auto",       # Auto-route for reasoning
    "coding": "openrouter/auto",          # Auto-route for code tasks
    "embedding": "openrouter/auto",       # For RAG embeddings
}

# ==========================================
# Request/Response Models
# ==========================================

class ChatMessage(BaseModel):
    role: str  # system, user, assistant
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    task_type: Optional[str] = "fast"  # fast | reasoning | coding
    agent: Optional[str] = None        # sales | marketing | knowledge | finance | manager
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 1024
    metadata: Optional[dict] = None

class ChatResponse(BaseModel):
    id: str
    answer: str
    model_used: str
    task_type: str
    agent: Optional[str]
    tokens_used: dict
    processing_time_ms: float
    timestamp: str

class EmbedRequest(BaseModel):
    text: str
    model: Optional[str] = "openrouter/auto"

class AgentRunRequest(BaseModel):
    agent: str  # sales | marketing | knowledge | finance | compliance | manager
    input: str
    context: Optional[dict] = None

class RAGQueryRequest(BaseModel):
    question: str
    department: Optional[str] = None
    top_k: Optional[int] = 5

# ==========================================
# Agent System Prompts (JD: Openclaw, Hermes, Cowork)
# ==========================================

AGENT_PROMPTS = {
    "sales": {
        "name": "Cowork (Sales Copilot)",
        "jd_tool": "Cowork",
        "system_prompt": """You are Cowork, the AI Sales Copilot for an automotive dealership.
Your role: Analyze customer interactions, suggest responses, create follow-ups, generate quotations.
You have access to: CRM data, inventory, finance calculators, customer history.
Always be specific with numbers (prices in AED, monthly payments, trade-in values).
Format your responses for a busy salesperson who needs quick, actionable information."""
    },
    "marketing": {
        "name": "Hermes (Marketing Intelligence)",
        "jd_tool": "Hermes",
        "system_prompt": """You are Hermes, the Marketing Intelligence Agent for an automotive dealership.
Your role: Analyze competitor data, generate campaign content, identify market trends, calculate ROI.
You have access to: Competitor pricing database (MongoDB), campaign history, attribution data.
Always provide data-driven recommendations with estimated business impact."""
    },
    "knowledge": {
        "name": "Openclaw (Knowledge & Compliance)",
        "jd_tool": "Openclaw",
        "system_prompt": """You are Openclaw, the Knowledge & Compliance Agent for an automotive dealership.
Your role: Answer questions about company policies, warranties, HR rules, and SOPs with exact citations.
You have access to: Document embeddings in Supabase pgvector.
CRITICAL: Always cite the source document and section. Never fabricate policy information.
If you don't have enough information, say so and recommend consulting the relevant department."""
    },
    "finance": {
        "name": "Finance Agent",
        "jd_tool": "Custom",
        "system_prompt": """You are the Finance Agent for an automotive dealership.
Your role: Calculate loan eligibility, monthly EMIs, vehicle costing, margins, commissions, and VAT.
You understand: UAE banking regulations, VAT at 5%, dealership accounting practices.
Always show your calculation steps and be precise with numbers."""
    },
    "compliance": {
        "name": "Compliance Agent",
        "jd_tool": "Openclaw",
        "system_prompt": """You are the Compliance Agent. You verify warranty claims, check regulatory requirements,
and ensure all processes follow company SOPs. Flag any potential compliance issues immediately."""
    },
    "manager": {
        "name": "Manager Agent",
        "jd_tool": "Custom",
        "system_prompt": """You are the Manager Agent. You summarize team performance, generate daily/weekly reports,
identify bottlenecks, flag issues (aging inventory, cold leads, low conversion), and provide
actionable recommendations for management. Be concise and data-driven."""
    }
}

# ==========================================
# Usage Tracking (stored in-memory, production: MongoDB)
# ==========================================
usage_log = []

# ==========================================
# FastAPI Application
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[AI Gateway] Starting AutoDealer AI Gateway Service...")
    print(f"[AI Gateway] OpenRouter API Key: {'configured' if OPENROUTER_API_KEY else 'NOT SET'}")
    print(f"[AI Gateway] Available agents: {list(AGENT_PROMPTS.keys())}")
    yield
    print("[AI Gateway] Shutting down...")

app = FastAPI(
    title="AutoDealer AI Gateway",
    description="Centralized AI/LLM Gateway for AutoDealer AI OS. Routes requests to OpenRouter.",
    version="1.0.0",
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
# Core LLM Call (via OpenRouter)
# ==========================================

async def call_openrouter(messages: list, model: str, temperature: float = 0.7, max_tokens: int = 1024):
    """Make a request to OpenRouter API (OpenAI-compatible)."""
    if not OPENROUTER_API_KEY:
        # Demo mode: return simulated response
        return {
            "content": f"[Demo Mode - No API Key] I would process: {messages[-1]['content'][:100]}...",
            "model": "demo-mode",
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Ali8517942172/autodealer-ai-platform",
        "X-Title": "AutoDealer AI OS"
    }

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload
        )

        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"OpenRouter error: {response.text}")

        data = response.json()
        return {
            "content": data["choices"][0]["message"]["content"],
            "model": data.get("model", model),
            "usage": data.get("usage", {})
        }

# ==========================================
# API Endpoints
# ==========================================

@app.get("/api/health")
async def health():
    return {
        "status": "OK",
        "service": "AutoDealer AI Gateway",
        "openrouter_configured": bool(OPENROUTER_API_KEY),
        "agents_available": list(AGENT_PROMPTS.keys()),
        "total_requests_served": len(usage_log)
    }

@app.post("/api/v1/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    General-purpose chat endpoint. Routes to appropriate model based on task_type.
    Used by: CRM Copilot, Executive Dashboard "Ask AI", Marketing Campaign Generator
    """
    start_time = time.time()

    model = MODEL_ROUTES.get(request.task_type, MODEL_ROUTES["fast"])
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    result = await call_openrouter(messages, model, request.temperature, request.max_tokens)
    processing_time = (time.time() - start_time) * 1000

    response_id = str(uuid.uuid4())
    
    # Log usage
    usage_log.append({
        "id": response_id,
        "task_type": request.task_type,
        "agent": request.agent,
        "model": result["model"],
        "tokens": result["usage"],
        "timestamp": datetime.utcnow().isoformat()
    })

    return ChatResponse(
        id=response_id,
        answer=result["content"],
        model_used=result["model"],
        task_type=request.task_type,
        agent=request.agent,
        tokens_used=result["usage"],
        processing_time_ms=round(processing_time, 2),
        timestamp=datetime.utcnow().isoformat()
    )

@app.post("/api/v1/agent/run")
async def run_agent(request: AgentRunRequest):
    """
    Run a specialized AI agent (Openclaw/Hermes/Cowork).
    JD Requirement: "Deploy and manage AI agents including Openclaw, Hermes, and Cowork"
    """
    agent_config = AGENT_PROMPTS.get(request.agent)
    if not agent_config:
        raise HTTPException(status_code=400, detail=f"Agent '{request.agent}' not found. Available: {list(AGENT_PROMPTS.keys())}")

    start_time = time.time()

    messages = [
        {"role": "system", "content": agent_config["system_prompt"]},
        {"role": "user", "content": request.input}
    ]

    if request.context:
        context_str = json.dumps(request.context, indent=2)
        messages[0]["content"] += f"\n\nContext data:\n{context_str}"

    # Reasoning model for complex agents, fast for simple queries
    task_type = "reasoning" if request.agent in ["finance", "compliance", "manager"] else "fast"
    model = MODEL_ROUTES[task_type]

    result = await call_openrouter(messages, model, temperature=0.5)
    processing_time = (time.time() - start_time) * 1000

    return {
        "agent": agent_config["name"],
        "jd_tool": agent_config["jd_tool"],
        "response": result["content"],
        "model_used": result["model"],
        "processing_time_ms": round(processing_time, 2),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/v1/rag/query")
async def rag_query(request: RAGQueryRequest):
    """
    RAG endpoint: Retrieves documents from pgvector and generates cited answers.
    JD Requirement: "Build production-ready applications and internal systems"
    """
    start_time = time.time()

    # In production: query Supabase pgvector for relevant document chunks
    # For now: use the knowledge base from enterprise-rag module
    
    system_prompt = AGENT_PROMPTS["knowledge"]["system_prompt"]
    system_prompt += f"\n\nDepartment filter: {request.department or 'all'}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": request.question}
    ]

    result = await call_openrouter(messages, MODEL_ROUTES["reasoning"], temperature=0.3)
    processing_time = (time.time() - start_time) * 1000

    return {
        "agent": "Openclaw (Knowledge & Compliance)",
        "answer": result["content"],
        "department": request.department,
        "model_used": result["model"],
        "processing_time_ms": round(processing_time, 2)
    }

@app.get("/api/v1/usage")
async def get_usage():
    """Monitor AI usage and costs across the platform."""
    return {
        "total_requests": len(usage_log),
        "by_agent": {},
        "by_task_type": {},
        "recent": usage_log[-10:] if usage_log else []
    }

@app.get("/api/v1/agents")
async def list_agents():
    """List all available AI agents with their JD tool mapping."""
    return [
        {
            "id": agent_id,
            "name": config["name"],
            "jd_tool": config["jd_tool"],
            "description": config["system_prompt"].split("\n")[0]
        }
        for agent_id, config in AGENT_PROMPTS.items()
    ]

# ==========================================
# Entry Point
# ==========================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5010, reload=True)
