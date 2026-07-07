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
        Mongo[(MongoDB Logs/Leads)]
        Vect[(pgvector / RAG)]
    end

    Auth --> PG
    Auth --> Mongo

    %% Business Modules (Apps)
    subgraph "Alba AI OS Modules"
        CRM[Alba AI CRM]
        Mktg[Marketing Intelligence OS]
        RAG[Enterprise Knowledge RAG]
        Inv[Inventory Intelligence]
        Exec[Executive Dashboard]
    end

    %% Agents and Automation
    subgraph "AI Agents & Automation"
        N8N[n8n / Make Engine]
        Cowork((Cowork Agent\nSales Copilot))
        Hermes((Hermes Agent\nMarketing))
        Openclaw((Openclaw Agent\nCompliance RAG))
    end

    %% Connections
    AG --> CRM
    AG --> Mktg
    AG --> Exec
    
    CRM <--> N8N
    Mktg <--> N8N
    
    N8N <--> Cowork
    N8N <--> Hermes
    
    RAG <--> Openclaw
    Openclaw <--> Vect
    
    CRM --> PG
    Mktg --> Mongo
    Exec --> PG
    Exec --> Mongo

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
2. **AI Segregation:** Specific agents handle specific domains (Cowork for Sales, Hermes for Marketing, Openclaw for Knowledge Retrieval).
3. **Single Source of Truth:** Odoo is the master for inventory; Supabase is the master for customer state and access control.
