"""Celery worker package.

Keep __init__ import-light so `celery -A app.worker.celery_app` does not
pull in the whole FastAPI app. Workers import what they need explicitly.
"""
