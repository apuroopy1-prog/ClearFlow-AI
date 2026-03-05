# ClearFlow AI

> **AI-powered financial management platform for small businesses** — built with Claude AI, LangGraph, FastAPI, and React.

[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![LangGraph](https://img.shields.io/badge/LangGraph-ReAct_Agent-FF6B35)](https://langchain-ai.github.io/langgraph/)
[![Claude](https://img.shields.io/badge/Claude-Opus_4.6-blueviolet)](https://anthropic.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docker.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql)](https://postgresql.org)

---

## What It Does

ClearFlow AI turns a bank statement PDF into a full financial intelligence dashboard — no manual data entry, no spreadsheets.

Upload your bank statement → AI extracts every transaction → ask questions in plain English → get forecasts, anomaly alerts, and budget tracking.

---

## Features

| Feature | Tech |
|---|---|
| **Bank PDF Parser** | `pdfplumber` + Claude Sonnet extracts transactions from any bank statement format |
| **Conversational AI** | LangGraph ReAct agent with persistent memory — ask questions about your finances across sessions |
| **Cash Flow Forecast** | Facebook Prophet time-series model, auto-configured based on data availability |
| **Anomaly Detection** | Claude identifies duplicate charges, unusual spikes, and suspicious patterns |
| **AI Insights** | Real-time financial analysis — income trends, expense patterns, recommendations |
| **Budget Goals** | Set monthly category limits, track progress with visual indicators |
| **Invoice Processing** | Upload invoices as PDFs/images, AI extracts vendor, amount, due date |
| **Multi-Currency** | USD, EUR, GBP, INR, AUD, CAD display with conversion |
| **Report Export** | Download transactions as PDF or Excel |
| **Scheduled Reports** | Monthly email reports via Celery beat + SMTP |

---

## Architecture

```
┌─────────────────┐     ┌────────────────────────────────────────┐
│   React (Vite)  │────▶│           FastAPI Backend               │
│   + TailwindCSS │     │                                        │
│   + Chart.js    │     │  ┌──────────────┐  ┌───────────────┐  │
└─────────────────┘     │  │ LangGraph    │  │ PDF Parser    │  │
                        │  │ ReAct Agent  │  │ pdfplumber    │  │
        Nginx           │  │ (3 tools)    │  │ + Claude      │  │
      (reverse          │  └──────┬───────┘  └───────────────┘  │
        proxy)          │         │                               │
                        │  ┌──────▼───────┐  ┌───────────────┐  │
                        │  │ Claude       │  │ Prophet       │  │
                        │  │ Opus 4.6     │  │ Forecasting   │  │
                        │  └──────────────┘  └───────────────┘  │
                        └────────────┬───────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              PostgreSQL           Redis           Celery
              (transactions,    (task queue)     (async jobs,
               invoices,                        monthly reports)
               budget goals)
```

---

## AI Stack

### LangGraph ReAct Agent
The chat feature uses a full LangGraph graph with:
- **MemorySaver** checkpointing — conversation history persists per user, per thread
- **3 tools**: `search_transactions` (RAG), `get_financial_summary`, `list_invoices`
- **System prompt** keeps Claude focused on financial context
- Conditional edges: agent decides whether to call tools or respond directly

```python
graph = StateGraph(AgentState)
graph.add_node("agent", call_model)
graph.add_node("tools", ToolNode(TOOLS))
graph.set_entry_point("agent")
graph.add_conditional_edges("agent", tools_condition)
graph.add_edge("tools", "agent")
```

### PDF Transaction Extraction
1. `pdfplumber.extract_tables()` — preserves column structure (Date | Description | Debit | Credit | Balance)
2. Pipe-separated rows sent to Claude Sonnet with explicit parsing rules
3. Fallback to `extract_text()` for image-based PDFs
4. MD5 deduplication — re-uploading the same statement never creates duplicates

### Facebook Prophet Forecasting
- Auto-detects yearly seasonality: enabled only when ≥12 months of data exist
- `n_changepoints` scaled to `n_months // 3` to prevent overfitting on sparse data
- Forecasts **net cash flow** (income + expenses) not revenue-only
- Returns empty state gracefully when data is insufficient

---

## Quick Start

### Prerequisites
- Docker + Docker Compose
- Anthropic API key

### Run

```bash
git clone https://github.com/apuroopy1-prog/clearflow-ai.git
cd clearflow-ai

cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY

docker compose up -d --build
```

Open [http://localhost](http://localhost)

### Default Login
Register a new account on first run.

---

## Project Structure

```
clearflow-ai/
├── backend/
│   ├── app/
│   │   ├── routers/          # FastAPI route handlers
│   │   │   ├── transactions.py   # Upload PDF/CSV, anomaly detection
│   │   │   ├── chat.py           # LangGraph agent, AI insights
│   │   │   ├── forecast.py       # Prophet forecasting
│   │   │   ├── invoices.py       # Invoice upload + processing
│   │   │   ├── budgets.py        # Budget goals CRUD
│   │   │   └── reports.py        # PDF/Excel export
│   │   ├── services/
│   │   │   ├── langgraph_chat.py     # LangGraph ReAct agent
│   │   │   ├── forecast_service.py   # Facebook Prophet wrapper
│   │   │   ├── rag_service.py        # Vector search for transactions
│   │   │   └── cache_invalidation.py # Cross-service cache management
│   │   ├── models.py         # SQLAlchemy ORM models
│   │   ├── schemas.py        # Pydantic schemas
│   │   └── main.py           # FastAPI app + middleware
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/            # Dashboard, Transactions, Forecasting, etc.
│   │   ├── contexts/         # AuthContext with JWT handling
│   │   └── services/         # API client (axios)
│   ├── package.json
│   └── Dockerfile
├── nginx/
│   └── nginx.conf
├── docker-compose.yml
└── .env.example
```

---

## Environment Variables

```env
# Database
POSTGRES_USER=accounting
POSTGRES_PASSWORD=your_password
POSTGRES_DB=accountingdb

# Security
SECRET_KEY=your_secret_key_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# AI
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **AI / LLM** | Anthropic Claude Opus 4.6, Claude Sonnet 4.6 |
| **Agent Framework** | LangGraph (ReAct), LangChain |
| **Forecasting** | Facebook Prophet |
| **PDF Extraction** | pdfplumber |
| **Backend** | FastAPI, SQLAlchemy, Pydantic, Celery |
| **Database** | PostgreSQL, Redis |
| **Frontend** | React 18, Vite, TailwindCSS, Chart.js |
| **Infrastructure** | Docker Compose, Nginx |
| **Auth** | JWT (access + refresh tokens) |

---

## Built By

**Apuroop Yarabarla** — AI/ML Engineer & AI Product Owner

[![LinkedIn](https://img.shields.io/badge/LinkedIn-apuroopyarabarla-0077B5?logo=linkedin)](https://linkedin.com/in/apuroopyarabarla)
[![GitHub](https://img.shields.io/badge/GitHub-apuroopy1--prog-181717?logo=github)](https://github.com/apuroopy1-prog)
