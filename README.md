# EKM 企业知识管理平台

Enterprise Knowledge Management Platform

## 项目概览

- **截止日期**: 2026-05-31
- **技术栈**: Next.js (React) + FastAPI (Python) + Elasticsearch + Qdrant + Neo4j
- **团队**: Kira-B (后端) · Kira-F (前端) · Kira-A (AI/KG) · Raven (DevOps) · Mira (测试)
- **验收**: Warren

## 快速开始

```bash
# 1. 准备环境变量
cp backend/.env.example backend/.env

# 2. 启动完整依赖 + 后端 API
#    migrate 服务会先跑 `alembic upgrade head`，再拉起 backend
docker compose up -d

# 3. 启动 Celery worker（按需，用于异步解析 / 向量化任务）
docker compose --profile worker up -d worker

# 4. 健康检查
curl localhost:8000/health
```

### 数据库迁移

- 本项目使用 Alembic 管理 schema，禁止使用 `metadata.create_all`
- Compose 启动时会自动执行 `alembic upgrade head`
- 本地开发手动执行：`cd backend && alembic upgrade head`
- 新增 / 变更表时：`alembic revision -m "描述"` 后手写 upgrade/downgrade

## 文档

详见 [EKM 开发计划](docs/plan.md)
