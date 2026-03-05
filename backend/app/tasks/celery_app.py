import os
from celery import Celery
from celery.schedules import crontab
from datetime import timedelta

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "clearflow-ai",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks.background_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    beat_schedule={
        "check-alerts-hourly": {
            "task": "app.tasks.background_tasks.check_alerts_task",
            "schedule": timedelta(hours=1),
        },
        "poll-gmail-5min": {
            "task": "app.tasks.background_tasks.poll_gmail_task",
            "schedule": timedelta(minutes=5),
        },
        "monthly-report-1st-8am": {
            "task": "app.tasks.background_tasks.send_all_monthly_reports_task",
            "schedule": crontab(hour=8, minute=0, day_of_month=1),
        },
    },
)
