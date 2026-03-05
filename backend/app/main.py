from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os

from app.database import init_db
from app.routers import auth, transactions, invoices, forecasting, notifications, chat, reports, gmail, budgets

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="ClearFlow AI API", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [o.strip() for o in _origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

uploads_dir = "/app/uploads"
os.makedirs(uploads_dir, exist_ok=True)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
app.include_router(invoices.router, prefix="/invoices", tags=["invoices"])
app.include_router(forecasting.router, prefix="/forecast", tags=["forecasting"])
app.include_router(notifications.router, prefix="/notify", tags=["notifications"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(gmail.router, prefix="/gmail", tags=["gmail"])
app.include_router(budgets.router, prefix="/budgets", tags=["budgets"])


@app.get("/health")
async def health():
    return {"status": "ok"}
