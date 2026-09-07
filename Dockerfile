FROM python:3.12-slim

ARG BIPFLOW_COMMIT_SHA

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BIPFLOW_COMMIT_SHA=${BIPFLOW_COMMIT_SHA}

LABEL org.opencontainers.image.source="https://github.com/edaquinogit/BipFlow" \
      org.opencontainers.image.revision="${BIPFLOW_COMMIT_SHA}" \
      org.opencontainers.image.title="BipFlow backend"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY bipdelivery ./bipdelivery
COPY docker/backend-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
    && adduser --disabled-password --gecos "" appuser \
    && mkdir -p /app/bipdelivery/staticfiles /app/bipdelivery/media /app/bipdelivery/logs \
    && chown -R appuser:appuser /app

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
# Shell form (not exec-form JSON) so ${PORT} expands: PaaS runtimes like
# Render inject their own PORT and expect the container to bind to it. Falls
# back to 8000 -- the docker-compose files never set PORT, so that path is
# unaffected.
#
# gthread + threads instead of more sync workers: most views here are
# I/O-bound (Postgres/Redis round trips), so threads buy concurrency without
# each one duplicating a full Django process's memory -- important on
# Render's free-tier RAM ceiling. 2x4 = 8 concurrent requests vs. the old
# 3 sync workers, at a lower memory footprint (fewer full processes).
CMD gunicorn bipdelivery.core.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --worker-class gthread --threads 4 --timeout 60
