# EKM 测试用例索引

> **关联 Issue**: #45 Week 5-6 测试用例编写
> **作者**: Mira Tang
> **最后更新**: 2026-04-20

---

## 文件列表

| 文件 | 内容 | 状态 | 依赖 |
|------|------|------|------|
| [tc-001-kg-pipeline.md](tc-001-kg-pipeline.md) | KG 构建测试（上传→流水线→Neo4j→可视化） | 待执行 | 依赖 #91 合入 main |
| [tc-002-agent-api.md](tc-002-agent-api.md) | Agent API 集成测试（外部 token 调用） | 待执行 | 依赖 #94 合入 main |
| [tc-003-warren-acceptance.md](tc-003-warren-acceptance.md) | 全流程验收剧本（Warren 验收用） | 可执行 | 已上线功能 |

---

## 可立即执行的测试

**TC-003** 中以下步骤可在当前 staging 上执行：

- STEP-01 至 STEP-13（登录、知识库、AI 对话、社区）
- STEP-14 至 STEP-17（归档审批流、批量操作）
- STEP-18（KG 可视化，需 staging 有 KG 数据）

**暂时跳过**（等功能合入 main）：
- TC-001 全部（等 #91）
- TC-002 全部（等 #94）
- STEP-18（等 #91，或确认 staging 已有 KG seed 数据）

---

## 测试账号

| 账号 | 密码 | 权限 |
|------|------|------|
| tom | Tom@EKM2026 | admin |

**Staging 地址**: https://ekm-frontend.fly.dev
