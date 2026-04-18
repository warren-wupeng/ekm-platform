# Dev Environment (Docker Compose)

One-shot bootstrap of the full EKM stack:
**FastAPI · PostgreSQL · Redis · Elasticsearch · Qdrant · Neo4j · Tika**

## Prerequisites

- Docker Desktop ≥ 4.25 (Compose V2)
- 8 GB RAM free (ES alone reserves 512 MB heap)
- Ports 5432 / 6379 / 6333-6334 / 7474 / 7687 / 8000 / 9200 / 9998 unused

## Start

```bash
cp backend/.env.example backend/.env
docker compose up -d
```

First build ~3 min, subsequent starts ~30 s.

## Verify

```bash
# API up
curl -s localhost:8000/health

# All services healthy
docker compose ps
```

You should see every service in `Up (healthy)` state.

## Service endpoints

| Service | Host port | UI / Docs |
|---|---|---|
| Backend API | 8000 | http://localhost:8000/docs |
| Postgres | 5432 | `psql postgres://ekm:ekm@localhost:5432/ekm` |
| Redis | 6379 | `redis-cli` |
| Elasticsearch | 9200 | http://localhost:9200 |
| Qdrant | 6333 / 6334 | http://localhost:6333/dashboard |
| Neo4j | 7474 / 7687 | http://localhost:7474 (neo4j / ekm_neo4j_pw) |
| Tika | 9998 | http://localhost:9998 |

## Logs / shell

```bash
docker compose logs -f backend        # tail backend logs
docker compose exec backend bash      # shell into backend container
docker compose exec postgres psql -U ekm ekm
```

## Celery worker (opt-in)

The worker is disabled by default (enabled in #9). To bring it up:

```bash
docker compose --profile worker up -d worker
```

## Teardown

```bash
docker compose down         # stop containers, keep volumes
docker compose down -v      # also drop all persistent data
```

## Troubleshooting

- **ES fails to start (137 OOM)** — bump Docker Desktop memory to ≥ 6 GB.
- **Backend can't connect to postgres** — make sure `depends_on.condition: service_healthy` waited; re-run `docker compose up -d`.
- **Port conflict** — adjust host-side port in `docker-compose.yml` (e.g. `"127.0.0.1:15432:5432"`).
