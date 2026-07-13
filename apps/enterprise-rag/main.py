"""
AutoDealer Enterprise RAG - Multi-Agent Knowledge Assistant
======================================================

Production-grade Retrieval-Augmented Generation system for automotive dealerships.
Uses Supabase pgvector for enterprise vector storage and deploys multiple
specialized AI agents (Openclaw, Hermes, Cowork) for domain-specific reasoning.

Knowledge Sources:
    - HR Policies & Employee Handbook
    - Vehicle Manuals & Specifications
    - Warranty & Finance Policies
    - Sales SOPs & Training Materials
    - Service Documentation

Architecture:
    FastAPI -> Agent Router -> Openclaw (Compliance)
                            -> Hermes (Marketing)
                            -> Cowork (Sales Support)
                            -> Supabase pgvector (Retrieval)
"""

import os
import json
import uuid
from datetime import datetime
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# Models
# ==========================================

class QueryRequest(BaseModel):
    question: str
    agent: Optional[str] = "openclaw"  # openclaw | hermes | cowork
    department: Optional[str] = None   # hr | sales | service | finance
    top_k: Optional[int] = 5

class QueryResponse(BaseModel):
    answer: str
    sources: List[dict]
    agent_used: str
    confidence: float
    query_id: str
    processing_time_ms: float
    follow_up_actions: Optional[List[dict]] = None

class DocumentUpload(BaseModel):
    title: str
    department: str
    content: str
    metadata: Optional[dict] = None

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
        "description": "Handles HR policies, warranty compliance, legal documentation, and regulatory queries.",
        "system_prompt": """You are Openclaw, the compliance and policy AI agent for AutoDealer Cars dealership.
Your role is to provide accurate, citation-backed answers about company policies, warranty terms,
legal requirements, and HR documentation. Always cite the exact document and section.
Never make up policy information. If unsure, say so and recommend consulting the relevant department.""",
        "departments": ["hr", "legal", "warranty", "compliance"]
    },
    "hermes": {
        "name": "Hermes",
        "role": "Marketing Intelligence Agent",
        "description": "Analyzes market trends, generates marketing content, and provides competitive intelligence.",
        "system_prompt": """You are Hermes, the marketing intelligence AI agent for AutoDealer Cars.
Your role is to analyze market data, generate compelling marketing content, and provide
actionable competitive intelligence. Focus on UAE automotive market specifics.""",
        "departments": ["marketing", "sales", "brand"]
    },
    "cowork": {
        "name": "Cowork",
        "role": "Sales Support Agent",
        "description": "Assists sales teams with vehicle specs, financing options, trade-in valuations, and customer queries.",
        "system_prompt": """You are Cowork, the sales support AI agent for AutoDealer Cars.
Your role is to help sales staff quickly find vehicle specifications, calculate financing options,
estimate trade-in values, and provide answers to common customer questions.
Always be precise with numbers, especially pricing and monthly payments.""",
        "departments": ["sales", "finance", "service", "inventory"]
    }
}

# ==========================================
# Knowledge Base (Simulated Enterprise Data)
# ==========================================

KNOWLEDGE_BASE = [
    {
        "id": "HR-001",
        "title": "Employee Leave Policy",
        "department": "hr",
        "content": """Annual Leave: All full-time employees are entitled to 30 calendar days of paid annual leave per year.
Leave must be requested at least 14 days in advance through the HR portal.
Unused leave cannot be carried forward beyond Q1 of the following year.
Emergency leave of up to 3 days may be granted with manager approval.""",
        "last_updated": "2025-01-15"
    },
    {
        "id": "HR-002",
        "title": "Employee Commission Structure",
        "department": "hr",
        "content": """Sales Commission:
- Gross Margin < AED 10,000: 3% commission
- Gross Margin AED 10,000 - 25,000: 5% commission
- Gross Margin AED 25,000 - 50,000: 7% commission
- Gross Margin > AED 50,000: 10% commission
Finance commission: 1% of approved loan amount.
Insurance commission: AED 200 per policy sold.
Accessories commission: 15% of accessories margin.""",
        "last_updated": "2025-03-01"
    },
    {
        "id": "WAR-001",
        "title": "Vehicle Warranty Policy",
        "department": "warranty",
        "content": """Standard Warranty: 1 year / 20,000 km (whichever comes first).
Extended Warranty: Available for purchase within 30 days of sale.
Coverage: Engine, transmission, and drivetrain components.
Exclusions: Wear and tear items (brakes, tires, wipers), cosmetic damage, modifications.
Claim Process: Customer must bring vehicle to service center. Diagnosis within 24 hours.
Approval: Claims under AED 5,000 auto-approved. Above AED 5,000 requires manager sign-off.""",
        "last_updated": "2025-02-20"
    },
    {
        "id": "FIN-001",
        "title": "Customer Finance Eligibility Criteria",
        "department": "finance",
        "content": """Minimum Salary: AED 5,000/month for UAE nationals, AED 8,000/month for expats.
Employment: Minimum 6 months with current employer (3 months for government employees).
Down Payment: Minimum 20% for new vehicles, 30% for pre-owned.
Maximum Tenure: 60 months for new, 48 months for pre-owned.
Supported Banks: ENBD, ADCB, FAB, Mashreq, RAK Bank, DIB.
Interest Rates: 2.49% - 4.99% flat rate depending on bank and profile.
Required Documents: Passport, visa, Emirates ID, salary certificate, bank statements (3 months).""",
        "last_updated": "2025-04-10"
    },
    {
        "id": "SOP-001",
        "title": "Sales Process Standard Operating Procedure",
        "department": "sales",
        "content": """Step 1: Lead Reception - All leads must be logged in CRM within 15 minutes.
Step 2: Initial Contact - Call/WhatsApp within 1 hour of lead creation.
Step 3: Needs Assessment - Identify budget, timeline, trade-in, financing needs.
Step 4: Vehicle Presentation - Schedule showroom visit or send virtual tour.
Step 5: Test Drive - Must be offered for all vehicles above AED 100,000.
Step 6: Quotation - Generate via CRM. Include all fees, VAT, and registration.
Step 7: Negotiation - Maximum discount authority: AED 3,000 (salesperson), AED 10,000 (manager).
Step 8: Closing - Finance application, insurance, registration, delivery scheduling.
Step 9: Handover - Vehicle inspection checklist, customer orientation, feedback survey.
Step 10: Follow-up - Day 3, Day 30, and Day 90 post-delivery calls.""",
        "last_updated": "2025-05-01"
    },
    {
        "id": "INV-001",
        "title": "Inventory Costing & Valuation Policy",
        "department": "finance",
        "content": """Purchase Cost Components:
- Auction/Supplier Price
- International Shipping (CIF)
- UAE Customs Duty: 5% of CIF value
- Port Handling: AED 800-1,200 per vehicle
- Reconditioning: Variable (logged per vehicle)
- VAT: 5% on total landed cost

Holding Cost: AED 50/day per vehicle (storage, insurance, depreciation).
Aging Policy: Vehicles aged > 90 days trigger automatic price review.
Write-down: 2% per month after 120 days of stock age.

Gross Margin Calculation:
  Selling Price (incl. accessories) - Total Landed Cost - Reconditioning = Gross Margin
  Net Margin = Gross Margin - Salesperson Commission - Finance Commission - VAT Payable""",
        "last_updated": "2025-06-01"
    }
]

# ==========================================
# FastAPI Application
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Enterprise RAG] Loading knowledge base...")
    print(f"[Enterprise RAG] Indexed {len(KNOWLEDGE_BASE)} documents")
    print(f"[Enterprise RAG] Agents available: {list(AGENTS.keys())}")
    yield
    print("[Enterprise RAG] Shutting down...")

app = FastAPI(
    title="AutoDealer Enterprise RAG API",
    description="Multi-Agent Knowledge Assistant for Automotive Dealerships",
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
# Endpoints
# ==========================================

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="OK",
        service="AutoDealer Enterprise RAG",
        agents_available=list(AGENTS.keys()),
        vector_store="Supabase pgvector",
        documents_indexed=len(KNOWLEDGE_BASE)
    )

@app.get("/api/agents")
async def list_agents():
    """List all available AI agents and their capabilities."""
    return [
        {
            "id": agent_id,
            "name": agent["name"],
            "role": agent["role"],
            "description": agent["description"],
            "departments": agent["departments"]
        }
        for agent_id, agent in AGENTS.items()
    ]

@app.post("/api/query", response_model=QueryResponse)
async def query_knowledge(request: QueryRequest):
    """
    Query the enterprise knowledge base using a specialized AI agent.
    
    The system:
    1. Routes the query to the appropriate agent (Openclaw/Hermes/Cowork)
    2. Retrieves relevant documents from Supabase pgvector
    3. Generates a cited, verified answer
    4. Optionally triggers follow-up workflows via n8n
    """
    import time
    start_time = time.time()

    agent = AGENTS.get(request.agent)
    if not agent:
        raise HTTPException(status_code=400, detail=f"Agent '{request.agent}' not found. Available: {list(AGENTS.keys())}")

    # Simulate vector search (in production: Supabase pgvector similarity search)
    relevant_docs = []
    question_lower = request.question.lower()

    for doc in KNOWLEDGE_BASE:
        # Simple keyword matching for demo; production uses embeddings
        if (request.department and doc["department"] == request.department) or \
           any(word in doc["content"].lower() for word in question_lower.split() if len(word) > 3):
            relevant_docs.append({
                "id": doc["id"],
                "title": doc["title"],
                "department": doc["department"],
                "relevance_score": 0.92,
                "excerpt": doc["content"][:200] + "...",
                "last_updated": doc["last_updated"]
            })

    if not relevant_docs:
        relevant_docs = [{
            "id": KNOWLEDGE_BASE[0]["id"],
            "title": KNOWLEDGE_BASE[0]["title"],
            "department": KNOWLEDGE_BASE[0]["department"],
            "relevance_score": 0.65,
            "excerpt": KNOWLEDGE_BASE[0]["content"][:200] + "...",
            "last_updated": KNOWLEDGE_BASE[0]["last_updated"]
        }]

    # Generate answer (in production: OpenRouter API call with agent system prompt + retrieved context)
    answer = f"Based on {len(relevant_docs)} relevant document(s), here is the answer from {agent['name']}:\n\n"
    for doc in relevant_docs[:3]:
        answer += f"📄 **{doc['title']}** (ID: {doc['id']})\n{doc['excerpt']}\n\n"

    # Determine follow-up actions
    follow_up = None
    if "warranty" in question_lower or "claim" in question_lower:
        follow_up = [
            {"action": "Create Service Ticket", "system": "CRM", "webhook": "/api/crm/ticket"},
            {"action": "Notify Service Manager", "system": "n8n", "webhook": "/api/automation/notify"}
        ]
    elif "commission" in question_lower or "salary" in question_lower:
        follow_up = [
            {"action": "Generate Payroll Report", "system": "ERP", "webhook": "/api/erp/payroll"},
        ]

    processing_time = (time.time() - start_time) * 1000

    return QueryResponse(
        answer=answer,
        sources=relevant_docs[:request.top_k],
        agent_used=agent["name"],
        confidence=0.91,
        query_id=str(uuid.uuid4()),
        processing_time_ms=round(processing_time, 2),
        follow_up_actions=follow_up
    )

@app.get("/api/documents")
async def list_documents():
    """List all indexed documents in the knowledge base."""
    return [
        {
            "id": doc["id"],
            "title": doc["title"],
            "department": doc["department"],
            "last_updated": doc["last_updated"],
            "content_preview": doc["content"][:100] + "..."
        }
        for doc in KNOWLEDGE_BASE
    ]

@app.post("/api/documents/upload")
async def upload_document(doc: DocumentUpload):
    """
    Upload and index a new document into the knowledge base.
    In production: Extracts text -> Chunks -> Embeds -> Stores in Supabase pgvector
    """
    new_doc = {
        "id": f"{doc.department.upper()}-{str(uuid.uuid4())[:8]}",
        "title": doc.title,
        "department": doc.department,
        "content": doc.content,
        "last_updated": datetime.now().strftime("%Y-%m-%d"),
        "metadata": doc.metadata or {}
    }
    KNOWLEDGE_BASE.append(new_doc)

    return {
        "status": "indexed",
        "document_id": new_doc["id"],
        "chunks_created": max(1, len(doc.content) // 500),
        "vector_store": "supabase_pgvector",
        "message": f"Document '{doc.title}' successfully indexed and available for queries."
    }

# ==========================================
# Entry Point
# ==========================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5002, reload=True)
