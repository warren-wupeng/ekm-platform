"""SMTP mailer — degradable.

If SMTP_HOST is unset, every send() call is a no-op that logs once at INFO.
If SMTP is configured but the send fails (timeout, auth error, whatever),
we log at WARNING and return False instead of propagating — email is a
best-effort channel in this system. The in-app notification is the durable
record; email is a nudge.

Both sync + async entry points exist so workers (sync Celery context) and
routers (async FastAPI context) can both call in without ceremony.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

log = logging.getLogger(__name__)


def _enabled() -> bool:
    return bool(settings.SMTP_HOST)


def send_sync(
    *,
    to: str,
    subject: str,
    body: str,
    html: str | None = None,
) -> bool:
    """Blocking send. Returns True on success, False on any failure or skip."""
    if not _enabled():
        log.info("mailer disabled (SMTP_HOST empty) — skipping to=%s", to)
        return False
    if not to:
        log.info("mailer skip: empty recipient")
        return False

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")

    try:
        # Short timeouts — the worker shouldn't hang on a slow relay.
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
            if settings.SMTP_USE_TLS:
                s.starttls()
            if settings.SMTP_USER:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as exc:
        log.warning("mailer send failed to=%s: %s", to, exc)
        return False


async def send(
    *,
    to: str,
    subject: str,
    body: str,
    html: str | None = None,
) -> bool:
    """Async wrapper — offloads smtplib onto a thread."""
    return await asyncio.to_thread(send_sync, to=to, subject=subject, body=body, html=html)
