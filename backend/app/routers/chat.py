import os
import time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Invoice, Transaction, User

router = APIRouter()

# Simple in-memory cache: {user_id: {"insights": [...], "ts": float}}
_insights_cache: dict = {}

from app.services.cache_invalidation import register_cache
register_cache("insights", _insights_cache)


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured")

    from app.services.rag_service import rag_service
    from app.services.langgraph_chat import invoke_agent

    # Lazily build the RAG index on first chat (or after invalidation)
    if not rag_service.has_index(current_user.id):
        txn_result = await db.execute(
            select(Transaction).where(Transaction.user_id == current_user.id)
        )
        inv_result = await db.execute(
            select(Invoice).where(Invoice.user_id == current_user.id)
        )
        transactions = txn_result.scalars().all()
        invoices = inv_result.scalars().all()
        rag_service.index_transactions(current_user.id, transactions)
        rag_service.index_invoices(current_user.id, invoices)

    reply = await invoke_agent(current_user.id, request.message)
    return ChatResponse(reply=reply)


@router.get("/insights")
async def get_insights(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return 2-3 AI-generated bullet insights about the user's finances. Cached 1 hour."""
    cached = _insights_cache.get(current_user.id)
    if cached and (time.time() - cached["ts"]) < 3600:
        return {"insights": cached["insights"]}

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured")

    result = await db.execute(
        select(Transaction).where(Transaction.user_id == current_user.id)
    )
    txns = result.scalars().all()
    if not txns:
        return {"insights": ["No transactions found — sync your bank feed to get AI insights."]}

    from collections import defaultdict
    income = sum(t.amount for t in txns if t.amount > 0)
    expenses = sum(abs(t.amount) for t in txns if t.amount < 0)
    net = income - expenses
    monthly: dict = defaultdict(float)
    category_spend: dict = defaultdict(float)
    for t in txns:
        monthly[t.date.strftime("%Y-%m")] += t.amount
        if t.amount < 0:
            category_spend[t.category or "Uncategorized"] += abs(t.amount)
    top_categories = sorted(category_spend.items(), key=lambda x: -x[1])[:5]

    summary_text = (
        f"Total income: ${income:,.2f}, Total expenses: ${expenses:,.2f}, Net: ${net:,.2f}. "
        f"Transaction count: {len(txns)}. "
        f"Top spending categories: {', '.join(f'{k} ${v:,.2f}' for k, v in top_categories)}. "
        f"Monthly breakdown: {dict(sorted(monthly.items())[-3:])}."
    )

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{
            "role": "user",
            # Financial insights prompt — contact author for implementation details.
            "content": (
                f"You are a financial advisor. Based on this data: {summary_text}\n"
                "Return exactly 3 actionable insights as a JSON array of strings."
            ),
        }],
    )

    import json, re
    raw = message.content[0].text.strip()
    insights = None
    # Try to extract a JSON array from anywhere in the response
    json_match = re.search(r'\[[\s\S]*?\]', raw)
    if json_match:
        try:
            parsed = json.loads(json_match.group())
            if isinstance(parsed, list):
                insights = [str(i).strip() for i in parsed if str(i).strip()]
        except Exception:
            pass
    if not insights:
        # Fallback: split by newline, skip lines that look like JSON syntax
        insights = [
            line.lstrip("•-123456789. \"").rstrip("\",").strip()
            for line in raw.splitlines()
            if line.strip()
            and not line.strip().startswith("[")
            and not line.strip().startswith("]")
            and not line.strip().startswith("```")
            and len(line.strip()) > 10
        ][:3]

    _insights_cache[current_user.id] = {"insights": insights, "ts": time.time()}
    return {"insights": insights}


@router.delete("/history")
async def clear_history(current_user: User = Depends(get_current_user)):
    """Reset the conversation history for the current user."""
    from app.services.langgraph_chat import clear_history
    clear_history(current_user.id)
    return {"message": "Conversation history cleared"}
