# Issue #68 E2E 测试报告

> **测试日期**: 2026-04-20
> **测试人员**: Mira Tang
> **测试环境**: Staging — https://ekm-frontend.fly.dev
> **测试账号**: tom / Tom@EKM2026（admin 权限）
> **关联 Issue**: #68 全流程端到端测试 + Bug 清零

---

## 总体结论

| 场景 | 结论 | Bug |
|------|------|-----|
| 登录 | ✅ 通过 | — |
| 场景 A：上传文档 → 搜索 | ❌ 失败 | #96 (P1), #97 (P2) |
| 场景 B：发帖 → 评论 → 通知 | ⚠️ 部分通过 | — |
| 场景 C：归档申请 → 审批 → 恢复 | ⚠️ 部分通过 | #98 (P1) |

**发现 Bug**：3 个（1×P1 上传、1×P2 搜索、1×P1 恢复流程）

---

## 登录功能

| 步骤 | 结果 | 备注 |
|------|------|------|
| 访问 https://ekm-frontend.fly.dev | ✅ | 自动跳转 /login |
| 登录页 UI | ✅ | 标题「欢迎回来」，中英文字段，SSO 入口可见 |
| 输入 tom / Tom@EKM2026 登录 | ✅ | 跳转至 /dashboard |
| Dashboard 概览 | ✅ | 显示「早上好，Tom」；本月上传 12、知识总量 247、社区互动 55、获赞 128 |

---

## 场景 A：上传文档 → 搜索关键词

### A-1 文件上传

**结论：❌ 失败**

**操作**: 调用 `POST /api/v1/files/upload` 上传 .txt 文件

**实际结果**:
```
HTTP 500
invalid input value for enum filetype: "DOCUMENT"
```

**根本原因**: `backend/app/models/knowledge.py:64` 中 `Enum(FileType)` 默认使用 Python enum name（大写，如 `DOCUMENT`）作为 PostgreSQL 存储值，但 DB 中 enum type 的实际值为小写（`document`）。

**Bug**: [#96 文件上传失败：SQLAlchemy Enum 大小写不匹配](https://github.com/warren-wupeng/ekm-platform/issues/96) **P1**

**影响**: 所有文档类型文件上传均失败（txt/md/docx/pdf/xlsx/csv/ppt/pptx）

---

### A-2 搜索关键词

**结论：❌ 失败（无法测试，因依赖上传）**

**操作**: 调用 `GET /api/v1/search/items?q=技术架构`；浏览器搜索页输入「技术架构」

**实际结果**:
- API 返回 `{"count": 0, "hits": []}`
- 前端显示「没有找到相关结果」
- 即使用已存在文档的名称关键词也无结果

**根本原因**: Elasticsearch 索引为空。已有文档（5 个）系直接写入 DB，未经解析流水线，无 chunk 数据。

**Bug**: [#97 搜索功能无结果：知识库文档未被 ES 索引](https://github.com/warren-wupeng/ekm-platform/issues/97) **P2**

---

## 场景 B：发帖 → 评论 → 检查通知

### B-1 发帖

**结论：✅ 通过**

**操作**: `POST /api/v1/posts` 创建帖子

**结果**:
```json
{"id": 2, "title": "[E2E测试] 场景B...", "reply_count": 0, "created_at": "2026-04-20T00:26:56..."}
HTTP 201
```

---

### B-2 评论帖子

**结论：✅ 通过**

**操作**: `POST /api/v1/posts/2/replies` 对自己帖子评论

**结果**:
```json
{"id": 1, "post_id": 2, "content": "E2E测试评论...", "like_count": 0}
HTTP 201
```

帖子 reply_count 从 0 → 1，更新正确。

---

### B-3 检查通知中心

**结论：⚠️ 部分通过**

**观察**:
- 右上角通知铃铛：显示「2」未读徽章 ✅
- 点击铃铛：通知面板弹出，显示 3 条通知内容（分享、点赞、月报生成）✅
- 通知 API (`GET /api/v1/notifications`) → **404** ⚠️

**分析**:
- 通知 UI 正常展示（可能使用 seeded/mock 数据）
- 自己评论自己的帖子不产生通知（符合预期）
- 后端通知 API 路由在 staging 返回 404（部署问题）

---

## 场景 C：归档申请 → 审批 → 恢复

### C-1 归档管理页面

**结论：✅ 通过**

**观察**:
- 归档列表：4 个已归档文件正确展示
- 恢复审批：3 条历史记录，1 条待审批（Luca 的「竞品分析 Q3 2025.xlsx」）
- UI 交互正常，分 tab 展示

---

### C-2 Admin 审批恢复申请

**结论：✅ 通过（UI 层面）**

**操作**: 点击「批准」→ 确认弹窗 → 确认

**结果**:
- 恢复审批列表中「竞品分析 Q3 2025.xlsx」状态：「待审批」→「已通过 · Warren Wu · 2026-04-20」✅
- 恢复审批 tab 红点（待处理数量）消失 ✅

---

### C-3 验证文件实际恢复

**结论：❌ 失败**

**预期**: 批准后「竞品分析 Q3 2025.xlsx」从归档列表消失（或状态变为已恢复），重新出现在主知识库

**实际**: 归档列表中文件状态仍为「已归档」，未发生任何变化

**Bug**: [#98 恢复审批通过后归档列表状态未更新](https://github.com/warren-wupeng/ekm-platform/issues/98) **P1**

---

## Bug 汇总

| Issue | 标题 | 优先级 | 场景 |
|-------|------|--------|------|
| [#96](https://github.com/warren-wupeng/ekm-platform/issues/96) | 文件上传失败：SQLAlchemy Enum 大小写不匹配 | P1 | 场景 A |
| [#97](https://github.com/warren-wupeng/ekm-platform/issues/97) | 搜索功能无结果：知识库文档未被 ES 索引 | P2 | 场景 A |
| [#98](https://github.com/warren-wupeng/ekm-platform/issues/98) | 恢复审批通过后归档列表状态未更新 | P1 | 场景 C |

---

## 跳过的场景（等待功能完成）

- SSO 登录（等 4/27 入职后）
- 协作编辑（#39 未完成）

---

## 测试覆盖情况

| 功能 | 状态 | 说明 |
|------|------|------|
| 登录 / Dashboard | ✅ | 正常 |
| 知识库 UI | ✅ | 列表/上传面板 UI 正常 |
| 文件上传 API | ❌ | #96 P1 |
| 搜索 | ❌ | #97 P2（ES 索引空） |
| 社区发帖 | ✅ | 正常 |
| 社区评论 | ✅ | 正常，reply_count 更新正确 |
| 通知中心 UI | ✅ | 面板正常展示 |
| 通知 API | ⚠️ | 404，部署问题 |
| 归档管理 UI | ✅ | 正常 |
| 恢复审批 UI | ✅ | 状态流转正常 |
| 恢复实际执行 | ❌ | #98 P1 |

---

## 建议优先修复顺序

1. **#96** — 文件上传是核心功能，P1，修复后才能验证上传→搜索链路
2. **#98** — 归档恢复流程 P1，逻辑错误，影响数据完整性
3. **#97** — ES 索引问题，部分属于环境配置，需排查 staging 环境状态
