"""
LangGraph ReAct agent for multi-turn financial chat.
- Conversation history is stored in MemorySaver keyed by thread_id=str(user_id)
- Claude has 3 tools: search_transactions, get_financial_summary, list_invoices
- Tool implementations call rag_service (for search) or direct sync DB queries
"""
import logging
import operator
import os
from typing import Annotated, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode, tools_condition

logger = logging.getLogger(__name__)

# ── Shared state ─────────────────────────────────────────────────────────────

# Maps user_id → compiled LangGraph app (cached per process lifetime)
_agents: dict[int, object] = {}
# Current user_id injected before each invocation (thread-local would be safer
# in production; for this single-process POC a module-level var is fine)
_current_user_id: int | None = None


# ── Tool definitions ─────────────────────────────────────────────────────────

@tool
def search_transactions(query: str) -> str:
    """
    Search the user's financial transactions by description, category, merchant,
    or any keyword. Returns the most relevant matches.
    Use this to answer questions about specific spending, vendors, or time periods.
    """
    from app.services.rag_service import rag_service

    if _current_user_id is None:
        return "No user context available."

    results = rag_service.search(_current_user_id, query, n=8)
    if not results:
        return "No matching transactions found."

    lines = []
    for doc in results:
        m = doc["metadata"]
        lines.append(
            f"- {m['date']} | {m['description']} | {m.get('category','—')} "
            f"| {m.get('account','—')} | ${m['amount']:+,.2f}"
        )
    return "Matching transactions:\n" + "\n".join(lines)


@tool
def get_financial_summary() -> str:
    """
    Get the user's overall financial summary: total income, total expenses,
    net cash flow, transaction count, and monthly breakdown.
    Use this for high-level financial questions.
    """
    import os
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.models import Transaction
    from collections import defaultdict

    if _current_user_id is None:
        return "No user context available."

    sync_url = os.getenv("SYNC_DATABASE_URL", "postgresql://accounting:accounting123@db/accountingdb")
    engine = create_engine(sync_url)

    with Session(engine) as session:
        txns = session.execute(
            select(Transaction).where(Transaction.user_id == _current_user_id)
        ).scalars().all()

    if not txns:
        return "No transactions found."

    income = sum(t.amount for t in txns if t.amount > 0)
    expenses = sum(abs(t.amount) for t in txns if t.amount < 0)
    net = income - expenses

    by_category: dict = defaultdict(float)
    for t in txns:
        if t.category:
            by_category[t.category] += t.amount

    monthly: dict = defaultdict(float)
    for t in txns:
        monthly[t.date.strftime("%Y-%m")] += t.amount

    cat_lines = "\n".join(
        f"  {cat}: ${abs(amt):,.2f}" for cat, amt in sorted(by_category.items(), key=lambda x: x[1])
    )
    monthly_lines = "\n".join(
        f"  {m}: ${v:+,.2f}" for m, v in sorted(monthly.items())[-6:]
    )

    return (
        f"Financial Summary:\n"
        f"  Total Income:   ${income:,.2f}\n"
        f"  Total Expenses: ${expenses:,.2f}\n"
        f"  Net Cash Flow:  ${net:+,.2f}\n"
        f"  Transactions:   {len(txns)}\n\n"
        f"Spending by category:\n{cat_lines or '  None'}\n\n"
        f"Monthly breakdown (last 6 months):\n{monthly_lines or '  None'}"
    )


@tool
def list_invoices(status: str = "all") -> str:
    """
    List the user's invoices, optionally filtered by status.
    Valid status values: 'all', 'pending', 'processing', 'done', 'error'.
    Use this to answer questions about invoices or document processing.
    """
    import os
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.models import Invoice

    if _current_user_id is None:
        return "No user context available."

    sync_url = os.getenv("SYNC_DATABASE_URL", "postgresql://accounting:accounting123@db/accountingdb")
    engine = create_engine(sync_url)

    with Session(engine) as session:
        query = select(Invoice).where(Invoice.user_id == _current_user_id)
        if status != "all":
            query = query.where(Invoice.status == status)
        invoices = session.execute(query.order_by(Invoice.uploaded_at.desc())).scalars().all()

    if not invoices:
        return f"No invoices found{' with status: ' + status if status != 'all' else ''}."

    lines = [
        f"- {inv.filename} | status: {inv.status} | uploaded: {inv.uploaded_at.strftime('%Y-%m-%d')}"
        for inv in invoices
    ]
    return f"Invoices ({len(invoices)} total):\n" + "\n".join(lines)


# ── Graph definition ─────────────────────────────────────────────────────────

TOOLS = [search_transactions, get_financial_summary, list_invoices]
SYSTEM_PROMPT = (
    "You are ClearFlow AI, a helpful financial assistant for small businesses. "
    "You have access to the user's real financial data through tools. "
    "Use the tools to look up specific transactions, invoices, or summaries before answering. "
    "Be concise, professional, and format numbers with dollar signs and commas. "
    "Remember the full conversation history — reference previous answers when relevant."
)


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]


def _build_agent() -> object:
    model = ChatAnthropic(
        model="claude-opus-4-6",
        api_key=os.getenv("ANTHROPIC_API_KEY"),
        max_tokens=1024,
    ).bind_tools(TOOLS)

    def call_model(state: AgentState):
        messages = state["messages"]
        # Prepend system message if not already present
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)
        response = model.invoke(messages)
        return {"messages": [response]}

    graph = StateGraph(AgentState)
    graph.add_node("agent", call_model)
    graph.add_node("tools", ToolNode(TOOLS))
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", tools_condition)
    graph.add_edge("tools", "agent")

    checkpointer = MemorySaver()
    return graph.compile(checkpointer=checkpointer)


def get_agent(user_id: int) -> object:
    """Return (or build) the compiled LangGraph agent for this user."""
    if user_id not in _agents:
        _agents[user_id] = _build_agent()
    return _agents[user_id]


def clear_history(user_id: int) -> None:
    """Discard the agent (and its MemorySaver) for this user, resetting conversation."""
    _agents.pop(user_id, None)


async def invoke_agent(user_id: int, message: str) -> str:
    """
    Invoke the LangGraph agent for user_id with the given message.
    Returns the final text reply from Claude.
    """
    global _current_user_id
    _current_user_id = user_id

    agent = get_agent(user_id)
    config = {"configurable": {"thread_id": str(user_id)}}

    result = await agent.ainvoke(
        {"messages": [HumanMessage(content=message)]},
        config=config,
    )

    last = result["messages"][-1]
    reply = last.content
    # Handle structured content blocks (list of dicts)
    if isinstance(reply, list):
        reply = " ".join(
            block.get("text", "") for block in reply if block.get("type") == "text"
        ).strip()

    return reply or "I wasn't able to generate a response."
