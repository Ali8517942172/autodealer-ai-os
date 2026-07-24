# System Architecture

```mermaid
graph TD
    %% External Interfaces
    subgraph "External Interfaces"
        Web[Website Forms]
        Social[WhatsApp / Social Media]
        Call[Incoming Calls]
        CEO[Executive Access]
    end

    %% AI Gateway & Auth
    subgraph "API & Security Layer"
        AG[NodeJS API Gateway]
        Auth[Supabase Auth / RBAC]
        AG --> Auth
    end

    Web --> AG
    Social --> AG
    Call --> AG

    %% Core Databases
    subgraph "Data Storage"
        PG[(Supabase / Postgres)]
        Vect[(Supabase pgvector / RAG)]
    end

    Auth --> PG

    %% Business Modules (Apps)
    subgraph "NEXUS OS Modules"
        CRM[NEXUS OS AI CRM]
        Mktg[Marketing Intelligence OS]
        RAG[Enterprise Knowledge RAG]
        Inv[Inventory Intelligence]
        Exec[Executive Dashboard]
    end

    %% Agents and Automation
    subgraph "AI Agents & Automation"
        N8N[n8n / WAHA Engine]
        Sales((Sales Agent\nSales Copilot))
        Marketing((Marketing Agent\nMarketing))
        Knowledge((Knowledge Agent\nCompliance RAG))
    end

    %% Connections
    AG --> CRM
    AG --> Mktg
    AG --> Exec
    
    CRM <--> N8N
    Mktg <--> N8N
    
    N8N <--> Sales
    N8N <--> Marketing
    
    RAG <--> Knowledge
    Knowledge <--> Vect
    
    CRM --> PG
    Mktg --> PG
    Exec --> PG

    %% External Systems
    subgraph "External Dealership Systems"
        Odoo[Odoo ERP]
        Banks[Bank Loan APIs]
    end

    N8N <--> Odoo
    CRM <--> Banks
```

## Architecture Principles
1. **Event-Driven:** Every inbound lead or CRM change triggers an event in the n8n automation engine.
2. **AI Segregation:** Specific agents handle specific domains (Sales Agent for Sales, Marketing Agent for Marketing, Knowledge Agent for Knowledge Retrieval).
3. **Single Source of Truth:** Odoo is the master for inventory; Supabase is the master for customer state and access control.
