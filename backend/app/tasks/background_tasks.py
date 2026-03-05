import logging
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3)
def process_ocr_task(self, invoice_id: int):
    """
    Background task: run OCR on an uploaded invoice and save results to DB.
    Uses synchronous SQLAlchemy since Celery workers are sync.
    """
    logger.info(f"Starting OCR task for invoice {invoice_id}")

    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    import os

    sync_url = os.getenv("SYNC_DATABASE_URL", "postgresql://accounting:accounting123@db/accountingdb")
    engine = create_engine(sync_url)

    from app.models import Invoice
    from app.services.ocr_service import extract_text_from_file, parse_invoice_fields

    with Session(engine) as session:
        invoice = session.get(Invoice, invoice_id)
        if not invoice:
            logger.warning(f"Invoice {invoice_id} not found")
            return

        try:
            invoice.status = "processing"
            session.commit()

            ocr_text = extract_text_from_file(invoice.file_path)
            extracted = parse_invoice_fields(ocr_text)

            invoice.ocr_text = ocr_text
            invoice.extracted_data = extracted
            invoice.status = "done"
            session.commit()

            logger.info(f"OCR completed for invoice {invoice_id}")

            # Optionally trigger a mock email notification
            generate_monthly_report_task.delay(invoice.user_id)

        except Exception as exc:
            invoice.status = "error"
            session.commit()
            logger.error(f"OCR failed for invoice {invoice_id}: {exc}")
            raise self.retry(exc=exc, countdown=5)


@celery_app.task
def generate_monthly_report_task(user_id: int):
    """
    Background task: generate a real monthly summary PDF and email it to the user.
    """
    logger.info(f"Generating monthly report for user {user_id}")

    import os
    from datetime import datetime
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.models import User, Transaction

    sync_url = os.getenv("SYNC_DATABASE_URL", "postgresql://accounting:accounting123@db/accountingdb")
    engine = create_engine(sync_url)

    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            logger.warning(f"User {user_id} not found for monthly report")
            return

        txns = session.execute(
            select(Transaction).where(Transaction.user_id == user_id)
        ).scalars().all()

        income = sum(t.amount for t in txns if t.amount > 0)
        expenses = sum(abs(t.amount) for t in txns if t.amount < 0)
        from collections import defaultdict
        monthly: dict = defaultdict(float)
        for t in txns:
            monthly[t.date.strftime("%Y-%m")] += t.amount

        summary = {
            "total_income": round(income, 2),
            "total_expenses": round(expenses, 2),
            "net": round(income - expenses, 2),
            "transaction_count": len(txns),
            "monthly_breakdown": dict(sorted(monthly.items())[-6:]),
        }

        from app.services.report_service import generate_summary_pdf
        pdf_bytes = generate_summary_pdf(summary)

        month = datetime.utcnow().strftime("%B %Y")
        from app.email_utils import send_report_email
        send_report_email(user.email, pdf_bytes, month)

    logger.info(f"Monthly report sent for user {user_id}")


@celery_app.task
def send_all_monthly_reports_task():
    """Celery Beat task: send monthly PDF reports to all users on the 1st at 8am."""
    logger.info("Sending monthly reports to all users")

    import os
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.models import User

    sync_url = os.getenv("SYNC_DATABASE_URL", "postgresql://accounting:accounting123@db/accountingdb")
    engine = create_engine(sync_url)

    with Session(engine) as session:
        users = session.execute(select(User)).scalars().all()
        for user in users:
            generate_monthly_report_task.delay(user.id)

    logger.info(f"Queued monthly reports for all users")


@celery_app.task
def check_alerts_task():
    """
    Periodic task: check financial alert conditions for all users.
    Runs every hour via Celery Beat.
    """
    logger.info("Running scheduled alert checks for all users")

    import os
    from datetime import datetime, timedelta
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.models import User, Transaction, Invoice
    from app.services.notification_service import send_email

    sync_url = os.getenv("SYNC_DATABASE_URL", "postgresql://accounting:accounting123@db/accountingdb")
    engine = create_engine(sync_url)

    now = datetime.utcnow()
    thirty_days_ago = now - timedelta(days=30)
    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    with Session(engine) as session:
        users = session.execute(select(User)).scalars().all()

        for user in users:
            alerts = []

            # Alert 1: Invoices pending for > 30 days
            overdue = session.execute(
                select(Invoice).where(
                    Invoice.user_id == user.id,
                    Invoice.status == "pending",
                    Invoice.uploaded_at < thirty_days_ago,
                )
            ).scalars().all()
            if overdue:
                alerts.append(
                    f"{len(overdue)} invoice(s) have been pending for over 30 days."
                )

            # Alert 2: Monthly spending > $10,000
            month_txns = session.execute(
                select(Transaction).where(
                    Transaction.user_id == user.id,
                    Transaction.date >= current_month_start,
                )
            ).scalars().all()
            monthly_expenses = sum(abs(t.amount) for t in month_txns if t.amount < 0)
            if monthly_expenses > 10_000:
                alerts.append(
                    f"Monthly spending has exceeded $10,000 (current: ${monthly_expenses:,.2f})."
                )

            # Alert 3: All-time net cash flow negative
            all_txns = session.execute(
                select(Transaction).where(Transaction.user_id == user.id)
            ).scalars().all()
            net = sum(t.amount for t in all_txns)
            if net < 0:
                alerts.append(
                    f"Net cash flow is negative (${net:,.2f}). Review your expenses."
                )

            if alerts:
                send_email(
                    recipient=user.email,
                    message="ClearFlow AI Alerts:\n\n" + "\n".join(f"- {a}" for a in alerts),
                )
                logger.info(f"Sent {len(alerts)} alert(s) to {user.email}")

    logger.info("Alert check completed")


@celery_app.task
def poll_gmail_task():
    """
    Periodic task: poll connected Gmail accounts for invoice attachments.
    Runs every 5 minutes via Celery Beat.
    """
    logger.info("Polling Gmail for invoice attachments")

    import os
    import uuid
    from datetime import datetime
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.models import GmailCredentials, Invoice

    sync_url = os.getenv("SYNC_DATABASE_URL", "postgresql://accounting:accounting123@db/accountingdb")
    engine = create_engine(sync_url)
    upload_dir = "/app/uploads"

    with Session(engine) as session:
        all_creds = session.execute(select(GmailCredentials)).scalars().all()

        for creds in all_creds:
            try:
                from app.services.gmail_service import get_gmail_client, fetch_invoice_attachments

                service = get_gmail_client(creds, session)
                since = creds.last_checked_at or (datetime.utcnow().replace(hour=0, minute=0, second=0))
                attachments = fetch_invoice_attachments(service, since)

                for filename, file_bytes in attachments:
                    unique_name = f"{uuid.uuid4()}_{filename}"
                    file_path = os.path.join(upload_dir, unique_name)
                    with open(file_path, "wb") as f:
                        f.write(file_bytes)

                    invoice = Invoice(
                        user_id=creds.user_id,
                        filename=filename,
                        file_path=file_path,
                        status="pending",
                    )
                    session.add(invoice)
                    session.flush()
                    process_ocr_task.delay(invoice.id)

                creds.last_checked_at = datetime.utcnow()
                session.commit()
                logger.info(f"Processed {len(attachments)} attachment(s) for user {creds.user_id}")

            except Exception as e:
                logger.error(f"Gmail poll failed for user {creds.user_id}: {e}")
                continue

    logger.info("Gmail poll completed")
