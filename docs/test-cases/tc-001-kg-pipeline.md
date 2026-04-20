# TC-001 KG 构建测试

> **关联 Issue**: #45 Week 5-6 测试用例编写
> **状态**: 待执行（依赖 #91 KG 流水线合入 main）
> **作者**: Mira Tang
> **最后更新**: 2026-04-20
> **测试环境**: Staging — https://ekm-frontend.fly.dev
> **测试账号**: tom / Tom@EKM2026（admin 权限）

---

## 概述

验证从文档上传到 KG 可视化的完整构建链路：

```
文档上传 → Celery 任务入队 → Tika 解析 + Chunk → 向量化 → Neo4j 写入 → KG 可视化
```

---

## TC-001-01 文档上传触发 KG 流水线

| 字段 | 内容 |
|------|------|
| **前置条件** | 已登录 tom 账号；staging 后端、Celery worker、Neo4j 均正常运行 |
| **操作步骤** | 1. 进入「知识库」页面<br>2. 点击「上传文档」，选择一个包含专业术语的 `.docx` 或 `.pdf` 文件（建议 1–5 页，含明确实体和关系的文本）<br>3. 上传完成后记录返回的 `document_id`<br>4. 调用 `POST /api/v1/documents/{document_id}/parse` 触发解析任务<br>5. 记录返回的 `task_id` |
| **预期结果** | - 上传接口返回 `201 Created`，包含 `id`（document_id）<br>- 解析接口返回 `202 Accepted`，包含 `task_id` 和 `"status": "queued"` |
| **通过标准** | HTTP 状态码正确；task_id 非空；重复触发时返回 `"status": "already_parsing"` |

---

## TC-001-02 任务状态轮询（/kg-status）

| 字段 | 内容 |
|------|------|
| **前置条件** | TC-001-01 已通过，持有有效 `task_id` |
| **操作步骤** | 1. 每隔 3 秒调用 `GET /api/v1/tasks/{task_id}`<br>2. 记录每次返回的 `state` 字段<br>3. 等待 state 变为 `SUCCESS` 或 `FAILURE`（超时上限：3 分钟） |
| **预期结果** | - 状态依次经过：`PENDING` → `STARTED` → `SUCCESS`<br>- `SUCCESS` 时 `result` 字段包含 chunk 数量等元数据<br>- `FAILURE` 时 `error` 字段描述失败原因 |
| **通过标准** | 3 分钟内达到 `SUCCESS`；不出现 `FAILURE`；轮询接口始终返回 200 |

---

## TC-001-03 Neo4j 节点/关系写入验证

| 字段 | 内容 |
|------|------|
| **前置条件** | TC-001-02 已通过（任务 SUCCESS） |
| **操作步骤** | 1. 调用 `GET /api/v1/graph/health`，确认 `"ok": true`<br>2. 从 `SUCCESS` 的 result 中获取写入的实体 `external_id`<br>3. 调用 `GET /api/v1/graph/entities/{external_id}/neighbors?depth=1`<br>4. 检查返回的 `neighbors` 列表 |
| **预期结果** | - `/graph/health` 返回 `{"ok": true}`<br>- neighbors 列表非空，包含从文档中提取的实体节点<br>- 每个邻居节点包含 `external_id`、关系类型等字段 |
| **通过标准** | Neo4j 中存在对应实体；邻居数量 ≥ 1；关系类型与文档内容语义匹配 |

---

## TC-001-04 KG 可视化页面展示

| 字段 | 内容 |
|------|------|
| **前置条件** | TC-001-03 已通过（Neo4j 中有数据） |
| **操作步骤** | 1. 进入前端「KG 可视化」页面（`/knowledge-graph`）<br>2. 搜索或选择刚上传的文档<br>3. 查看图谱渲染结果<br>4. 尝试点击节点，查看节点详情 |
| **预期结果** | - 页面正常加载，无 JS 报错<br>- 图谱中显示文档对应的节点和关系<br>- 点击节点弹出详情面板，展示实体信息 |
| **通过标准** | 图谱非空；节点可交互；内容与文档语义一致 |

---

## TC-001-05 异常路径：无文件的文档触发解析

| 字段 | 内容 |
|------|------|
| **前置条件** | 存在一个没有关联文件的 document_id（数据库中 file_path 为空） |
| **操作步骤** | 调用 `POST /api/v1/documents/{document_id}/parse` |
| **预期结果** | 返回 `400 Bad Request`，body 包含 `"document has no file"` |
| **通过标准** | 状态码 400；错误信息准确 |

---

## TC-001-06 异常路径：不存在的 document_id

| 字段 | 内容 |
|------|------|
| **前置条件** | 无 |
| **操作步骤** | 调用 `POST /api/v1/documents/99999/parse` |
| **预期结果** | 返回 `404 Not Found`，body 包含 `"document not found"` |
| **通过标准** | 状态码 404；错误信息准确 |
