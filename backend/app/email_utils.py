import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from asyncio import get_event_loop
from functools import partial

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


def _send_smtp(to: str, subject: str, html: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_FROM, to, msg.as_string())


def send_report_email(to: str, pdf_bytes: bytes, month: str) -> None:
    """Send monthly PDF report as email attachment. Falls back to logging if SMTP not configured."""
    subject = f"ClearFlow AI — Monthly Report ({month})"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#2563eb">Your Monthly Financial Report</h2>
      <p>Please find your ClearFlow AI monthly summary for <strong>{month}</strong> attached as a PDF.</p>
      <p style="color:#6b7280;font-size:12px">Generated automatically by ClearFlow AI.</p>
    </div>
    """

    if SMTP_HOST and SMTP_USER:
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM
        msg["To"] = to
        msg.attach(MIMEText(html, "html"))

        attachment = MIMEBase("application", "octet-stream")
        attachment.set_payload(pdf_bytes)
        encoders.encode_base64(attachment)
        attachment.add_header("Content-Disposition", f'attachment; filename="report-{month}.pdf"')
        msg.attach(attachment)

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, to, msg.as_string())
    else:
        logger.info(
            f"\n========== MONTHLY REPORT (no SMTP configured) ==========\n"
            f"  To: {to}\n"
            f"  Month: {month}\n"
            f"  PDF size: {len(pdf_bytes)} bytes\n"
            "=========================================================="
        )


async def send_reset_email(to: str, reset_link: str) -> None:
    subject = "ClearFlow AI — Password Reset"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#2563eb">Reset your password</h2>
      <p>Click the button below to reset your ClearFlow AI password.
         This link expires in <strong>15 minutes</strong>.</p>
      <a href="{reset_link}"
         style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;
                border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
        Reset Password
      </a>
      <p style="color:#6b7280;font-size:12px">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    """

    if SMTP_HOST and SMTP_USER:
        loop = get_event_loop()
        await loop.run_in_executor(None, partial(_send_smtp, to, subject, html))
    else:
        # Dev fallback — print link to logs
        logger.warning(
            "\n"
            "========== PASSWORD RESET (no SMTP configured) ==========\n"
            f"  To: {to}\n"
            f"  Link: {reset_link}\n"
            "=========================================================="
        )
