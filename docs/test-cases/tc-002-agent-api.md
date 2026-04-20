# TC-002 Agent API 集成测试

> **关联 Issue**: #45 Week 5-6 测试用例编写；#49 Agent API；#94 Agent API PR
> **状态**: 待执行（依赖 #94 Agent API PR 合入 main）
> **作者**: Mira Tang
> **最后更新**: 2026-04-20
> **测试环境**: Staging — https://ekm-frontend.fly.dev
> **鉴权方式**: 外部 JWT token（Bearer），通过 `/api/v1/auth/login` 获取

---

## 概述

验证外部系统通过 Agent API 访问 EKM 知识库和 KG 的集成能力，涵盖：
- `/api/agent/knowledge/search` — 知识库语义搜索
- `/api/agent/kg/query` — KG 关系路径查询
- `/api/agent/kg/node` — KG 节点读写

每个接口测试：正常路径 + 权限错误 + 速率限制（如已实现）

---

## 环境准备

```bash
# 获取 access_token
curl -s -X POST https://ekm-frontend.fly.dev/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tom","password":"Tom@EKM2026"}' \
  | jq '.access_token'
```

---

## TC-002-01 knowledge/search — 正常查询

| 字段 | 内容 |
|------|------|
| **前置条件** | 已持有有效 access_token；知识库中有已上传并解析的文档 |
| **操作步骤** | 调用 `GET /api/agent/knowledge/search?q=<关键词>&size=5`，Header 带 `Authorization: Bearer <token>` |
| **预期结果** | - 返回 200<br>- body 包含 `hits` 数组，每条含文档标题、相关片段、相关度分数 |
| **通过标准** | 返回结果与查询语义相关；size 参数生效 |

---

## TC-002-02 knowledge/search — 无 token 访问

| 字段 | 内容 |
|------|------|
| **前置条件** | 无 |
| **操作步骤** | 调用 `GET /api/agent/knowledge/search?q=test`，不带 Authorization Header |
| **预期结果** | 返回 `401 Unauthorized` |
| **通过标准** | 状态码 401；body 包含明确的鉴权错误信息 |

---

## TC-002-03 knowledge/search — 无效 token

| 字段 | 内容 |
|------|------|
| **前置条件** | 无 |
| **操作步骤** | 调用接口，带 `Authorization: Bearer invalid_token_xyz` |
| **预期结果** | 返回 `401 Unauthorized` |
| **通过标准** | 状态码 401；不返回任何数据 |

---

## TC-002-04 kg/query — 正常关系路径查询

| 字段 | 内容 |
|------|------|
| **前置条件** | 已持有有效 token；Neo4j 中有实体数据（参见 TC-001-03） |
| **操作步骤** | 调用 `POST /api/agent/kg/query`，body 为 `{"entity": "<实体名>", "depth": 2}` |
| **预期结果** | - 返回 200<br>- body 包含实体的关系路径列表，每条路径标注关系类型和目标节点 |
| **通过标准** | 路径结果非空（前提：该实体在 KG 中存在）；depth 参数生效（限制跳数） |

---

## TC-002-05 kg/query — 不存在的实体

| 字段 | 内容 |
|------|------|
| **前置条件** | 已持有有效 token |
| **操作步骤** | 调用 `POST /api/agent/kg/query`，body 为 `{"entity": "不存在的实体XYZ123"}` |
| **预期结果** | 返回 200，`paths` 数组为空；或 404 |
| **通过标准** | 不返回 5xx；空结果的处理方式明确（空数组 vs 404，以实际实现为准，记录到文档） |

---

## TC-002-06 kg/node — 读取节点信息

| 字段 | 内容 |
|------|------|
| **前置条件** | 已持有有效 token；持有已知 `external_id` |
| **操作步骤** | 调用 `GET /api/agent/kg/node/{external_id}` |
| **预期结果** | - 返回 200<br>- body 包含节点属性：标签、名称、创建时间等 |
| **通过标准** | 返回的节点数据与 TC-001-03 中写入的数据一致 |

---

## TC-002-07 速率限制验证（如已实现）

| 字段 | 内容 |
|------|------|
| **前置条件** | 已持有有效 token；Agent API 已配置速率限制 |
| **操作步骤** | 在 1 分钟内连续发送超过限额的请求（如限额为 60/min，则发送 65 次） |
| **预期结果** | 超限后返回 `429 Too Many Requests`；Header 中包含 `Retry-After` 或 `X-RateLimit-*` |
| **通过标准** | 限流触发后不返回 5xx；Retry-After 信息准确 |

> **注**：若当前 staging 未实现速率限制，记录为「待实现」，跳过本用例。
