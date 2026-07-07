# AI Gateway Service

## Business Problem
Multiple services across the platform (CRM, Marketing, RAG, Inventory) each need AI/LLM capabilities. Without centralization, every service independently manages API keys, model selection, and error handling — creating security risks, inconsistent behavior, and impossible cost tracking.

## Current Manual Process
1. Each developer hardcodes API keys in individual services
2. No visibility into total AI usage or costs
3. Model changes require updating every service
4. No intelligent routing — expensive models used for simple tasks

## AI-Powered Solution
A centralized AI Gateway that routes all LLM requests through OpenRouter's API. Features intelligent model selection based on task complexity, unified usage tracking, and standardized agent interfaces.

## Business Workflow
```
Any Service (CRM, Marketing, RAG, Dashboard)
    ↓
AI Gateway (/api/v1/chat or /api/v1/agent/run)
    ↓
Task Classification (fast | reasoning | coding)
    ↓
Model Selection (auto-routed via OpenRouter)
    ↓
Response + Usage Logging
    ↓
Back to calling service
```

## JD Tool Mapping
| JD Requirement | Implementation |
|---------------|----------------|
| Openclaw Agent | `/api/v1/agent/run?agent=knowledge` - Knowledge & Compliance |
| Hermes Agent | `/api/v1/agent/run?agent=marketing` - Marketing Intelligence |
| Cowork Agent | `/api/v1/agent/run?agent=sales` - Sales Copilot |
| Additional Agents | finance, compliance, manager |

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/chat` | General-purpose LLM chat |
| POST | `/api/v1/agent/run` | Run a specialized agent |
| POST | `/api/v1/rag/query` | RAG query with citations |
| GET | `/api/v1/agents` | List available agents |
| GET | `/api/v1/usage` | Usage monitoring |
| GET | `/api/health` | Health check |

## Cost: ₹0
Uses OpenRouter's free model routing. No paid API keys required for demo.
