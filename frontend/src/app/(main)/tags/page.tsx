'use client'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App, Button, Input, Tag, Select, Popconfirm,
  Modal, Form, ColorPicker, Tabs, Checkbox, Tooltip,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, TagOutlined,
  ApartmentOutlined, SearchOutlined, CheckOutlined,
  TagsOutlined, FolderOutlined, FolderOpenOutlined,
} from '@ant-design/icons'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string
  name: string
  slug: string
  parentId: string | null
  description: string
  sortOrder: number
}

interface TagItem {
  id: string
  name: string
  color: string
  usageCount: number
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const INIT_CATEGORIES: Category[] = [
  { id: 'c1', name: '技术文档', slug: 'tech',        parentId: null, description: '工程和研发相关文档', sortOrder: 0 },
  { id: 'c2', name: '产品资料', slug: 'product',     parentId: null, description: '产品需求和规划',   sortOrder: 1 },
  { id: 'c3', name: '市场运营', slug: 'marketing',   parentId: null, description: '市场和运营资料',   sortOrder: 2 },
  { id: 'c4', name: '架构设计', slug: 'arch',        parentId: 'c1', description: '系统架构和设计方案', sortOrder: 0 },
  { id: 'c5', name: 'API 文档', slug: 'api',         parentId: 'c1', description: 'API 接口文档',    sortOrder: 1 },
  { id: 'c6', name: 'PRD',      slug: 'prd',         parentId: 'c2', description: '产品需求文档',     sortOrder: 0 },
  { id: 'c7', name: '竞品分析', slug: 'competitive', parentId: 'c2', description: '竞品分析报告',     sortOrder: 1 },
]

const INIT_TAGS: TagItem[] = [
  { id: 't1', name: 'LLM',       color: '#6366f1', usageCount: 18 },
  { id: 't2', name: 'RAG',       color: '#8b5cf6', usageCount: 12 },
  { id: 't3', name: '架构',      color: '#3b82f6', usageCount: 21 },
  { id: 't4', name: '数据库',    color: '#06b6d4', usageCount: 9  },
  { id: 't5', name: '前端',      color: '#10b981', usageCount: 15 },
  { id: 't6', name: '后端',      color: '#f59e0b', usageCount: 11 },
  { id: 't7', name: 'API',       color: '#ef4444', usageCount: 24 },
  { id: 't8', name: '产品',      color: '#ec4899', usageCount: 8  },
  { id: 't9', name: '规范',      color: '#64748b', usageCount: 6  },
  { id: 't10',name: '周报',      color: '#84cc16', usageCount: 14 },
  { id: 't11',name: '安全',      color: '#f97316', usageCount: 5  },
  { id: 't12',name: 'DevOps',    color: '#0ea5e9', usageCount: 7  },
]

// Mock documents for batch tagging
const MOCK_DOCS = [
  { id: 'doc1', name: '技术架构设计.docx',   tags: ['t3', 't1'] },
  { id: 'doc2', name: 'EKM 调研报告.pdf',   tags: ['t2', 't1'] },
  { id: 'doc3', name: 'API 设计规范.md',    tags: ['t7', 't9'] },
  { id: 'doc4', name: '前端组件规范.md',    tags: ['t5', 't9'] },
  { id: 'doc5', name: '数据库设计文档.pdf', tags: ['t4', 't3'] },
  { id: 'doc6', name: 'CI/CD 流程说明.md', tags: ['t12']       },
]

function uid() { return `_${Math.random().toString(36).slice(2)}` }

// ── Category tree ─────────────────────────────────────────────────────────────

function CategoryTree({
  categories,
  parentId = null,
  level = 0,
  onEdit,
  onDelete,
  onAdd,
  t,
}: {
  categories: Category[]
  parentId: string | null
  level?: number
  onEdit: (c: Category) => void
  onDelete: (id: string) => void
  onAdd: (parentId: string | null) => void
  t: (key: string) => string
}) {
  const nodes = categories.filter((c) => c.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['c1', 'c2']))

  if (nodes.length === 0 && level > 0) return null

  return (
    <div className={level > 0 ? 'ml-5 border-l border-slate-100 pl-3' : ''}>
      {nodes.map((cat) => {
        const hasChildren = categories.some((c) => c.parentId === cat.id)
        const isOpen = expanded.has(cat.id)
        return (
          <div key={cat.id}>
            <div className="flex items-center gap-2 py-1.5 px-2 rounded-xl hover:bg-slate-50 group">
              <button
                className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-slate-400"
                onClick={() => setExpanded((prev) => {
                  const next = new Set(prev)
                  next.has(cat.id) ? next.delete(cat.id) : next.add(cat.id)
                  return next
                })}
              >
                {hasChildren
                  ? (isOpen ? <FolderOpenOutlined className="text-xs text-amber-500" /> : <FolderOutlined className="text-xs text-amber-400" />)
                  : <FolderOutlined className="text-xs text-slate-300" />
                }
              </button>
              <span className="flex-1 text-sm text-slate-700">{cat.name}</span>
              <span className="text-[10px] text-slate-400 hidden group-hover:inline">{cat.slug}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
                <Tooltip title={t('tags.add_subcategory')}>
                  <button
                    className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-primary hover:bg-slate-100 transition-colors"
                    onClick={() => onAdd(cat.id)}
                  >
                    <PlusOutlined className="text-[10px]" />
                  </button>
                </Tooltip>
                <Tooltip title={t('common.edit')}>
                  <button
                    className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-primary hover:bg-slate-100 transition-colors"
                    onClick={() => onEdit(cat)}
                  >
                    <EditOutlined className="text-[10px]" />
                  </button>
                </Tooltip>
                <Popconfirm
                  title={t('tags.confirm_delete_cat')}
                  description={t('tags.confirm_delete_cat_desc')}
                  okText={t('common.delete')} cancelText={t('common.cancel')}
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onDelete(cat.id)}
                >
                  <Tooltip title={t('common.delete')}>
                    <button className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-50 transition-colors">
                      <DeleteOutlined className="text-[10px]" />
                    </button>
                  </Tooltip>
                </Popconfirm>
              </div>
            </div>
            {isOpen && (
              <CategoryTree
                categories={categories}
                parentId={cat.id}
                level={level + 1}
                onEdit={onEdit}
                onDelete={onDelete}
                onAdd={onAdd}
                t={t}
              />
            )}
          </div>
        )
      })}
      {level === 0 && (
        <button
          className="mt-1 ml-2 flex items-center gap-1 text-xs text-primary hover:opacity-70 py-1"
          onClick={() => onAdd(null)}
        >
          <PlusOutlined className="text-xs" />{t('tags.add_top_category')}
        </button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TagsPage() {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [categories, setCategories]       = useState<Category[]>(INIT_CATEGORIES)
  const [tags, setTags]                   = useState<TagItem[]>(INIT_TAGS)
  const [tagSearch, setTagSearch]         = useState('')
  const [catModal, setCatModal]           = useState<{ open: boolean; item?: Category; parentId?: string | null }>({ open: false })
  const [tagModal, setTagModal]           = useState<{ open: boolean; item?: TagItem }>({ open: false })
  const [catForm] = Form.useForm()
  const [tagForm] = Form.useForm()

  // Batch tagging state
  const [selectedDocs, setSelectedDocs]   = useState<Set<string>>(new Set())
  const [batchTagIds, setBatchTagIds]     = useState<string[]>([])
  const [docTags, setDocTags]             = useState<Record<string, string[]>>(
    Object.fromEntries(MOCK_DOCS.map((d) => [d.id, d.tags]))
  )

  // ── Category CRUD ─────────────────────────────────────────────────────────

  function openCatModal(item?: Category, parentId?: string | null) {
    if (item) catForm.setFieldsValue({ name: item.name, slug: item.slug, description: item.description })
    else catForm.resetFields()
    setCatModal({ open: true, item, parentId: parentId ?? null })
  }

  function saveCat(values: { name: string; slug: string; description: string }) {
    if (catModal.item) {
      setCategories((prev) => prev.map((c) => c.id === catModal.item!.id ? { ...c, ...values } : c))
      message.success(t('tags.cat_updated'))
    } else {
      const newCat: Category = {
        id: uid(), name: values.name, slug: values.slug,
        parentId: catModal.parentId ?? null,
        description: values.description ?? '',
        sortOrder: categories.filter((c) => c.parentId === catModal.parentId).length,
      }
      setCategories((prev) => [...prev, newCat])
      message.success(t('tags.cat_created'))
    }
    setCatModal({ open: false })
  }

  function deleteCategory(id: string) {
    // Promote children to grandparent
    const target = categories.find((c) => c.id === id)
    setCategories((prev) => prev.filter((c) => c.id !== id).map((c) => c.parentId === id ? { ...c, parentId: target?.parentId ?? null } : c))
    message.success(t('tags.cat_deleted'))
  }

  // ── Tag CRUD ──────────────────────────────────────────────────────────────

  function openTagModal(item?: TagItem) {
    if (item) tagForm.setFieldsValue({ name: item.name, color: item.color })
    else tagForm.resetFields()
    setTagModal({ open: true, item })
  }

  function saveTag(values: { name: string; color: string }) {
    const colorStr = typeof values.color === 'object' ? (values.color as any).toHexString?.() ?? '#6366f1' : values.color
    if (tagModal.item) {
      setTags((prev) => prev.map((t) => t.id === tagModal.item!.id ? { ...t, name: values.name, color: colorStr } : t))
      message.success(t('tags.tag_updated'))
    } else {
      setTags((prev) => [...prev, { id: uid(), name: values.name, color: colorStr, usageCount: 0 }])
      message.success(t('tags.tag_created'))
    }
    setTagModal({ open: false })
  }

  function deleteTag(id: string) {
    setTags((prev) => prev.filter((t) => t.id !== id))
    setDocTags((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((k) => { next[k] = next[k].filter((tid) => tid !== id) })
      return next
    })
    message.success(t('tags.tag_deleted'))
  }

  // ── Batch tagging ─────────────────────────────────────────────────────────

  function applyBatchTags() {
    if (!selectedDocs.size) { message.warning(t('tags.select_docs_first')); return }
    if (!batchTagIds.length) { message.warning(t('tags.select_tags_first')); return }
    setDocTags((prev) => {
      const next = { ...prev }
      selectedDocs.forEach((id) => {
        const existing = new Set(next[id] ?? [])
        batchTagIds.forEach((tid) => existing.add(tid))
        next[id] = Array.from(existing)
      })
      return next
    })
    message.success(t('tags.batch_applied', { tagCount: batchTagIds.length, docCount: selectedDocs.size }))
    setSelectedDocs(new Set())
    setBatchTagIds([])
  }

  const filteredTags = useMemo(
    () => tags.filter((t) => !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase())),
    [tags, tagSearch]
  )

  const maxUsage = Math.max(...tags.map((t) => t.usageCount), 1)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-4">
        <div className="flex items-center gap-2">
          <TagsOutlined className="text-slate-500 text-lg" />
          <h1 className="text-lg font-semibold text-slate-800">{t('tags.page_title')}</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        <Tabs
          items={[
            // ── Tab 1: Categories ────────────────────────────────────────────
            {
              key: 'categories',
              label: <span><ApartmentOutlined className="mr-1" />{t('tags.tab_categories')}</span>,
              children: (
                <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-slate-500">{t('tags.category_desc')}</p>
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openCatModal()}>
                      {t('tags.add_category')}
                    </Button>
                  </div>
                  <CategoryTree
                    categories={categories}
                    parentId={null}
                    onEdit={(c) => openCatModal(c)}
                    onDelete={deleteCategory}
                    onAdd={(pid) => openCatModal(undefined, pid)}
                    t={t}
                  />
                </div>
              ),
            },

            // ── Tab 2: Tags ──────────────────────────────────────────────────
            {
              key: 'tags',
              label: <span><TagOutlined className="mr-1" />{t('tags.tab_tags')}</span>,
              children: (
                <div className="space-y-4">
                  {/* Tag cloud */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-medium text-slate-700">{t('tags.tag_cloud')}</p>
                        <Input
                          size="small" placeholder={t('tags.search_tags')}
                          prefix={<SearchOutlined className="text-slate-300 text-xs" />}
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                          allowClear
                          style={{ width: 140 }}
                        />
                      </div>
                      <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openTagModal()}>
                        {t('tags.add_tag')}
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {filteredTags.map((tag) => {
                        const sizeRem = 0.75 + (tag.usageCount / maxUsage) * 0.5
                        return (
                          <div key={tag.id} className="group flex items-center gap-1">
                            <Tag
                              color={tag.color}
                              style={{ fontSize: `${sizeRem}rem`, cursor: 'default', userSelect: 'none' }}
                              className="m-0"
                            >
                              {tag.name}
                              <span style={{ fontSize: '0.65rem', opacity: 0.7, marginLeft: 3 }}>{tag.usageCount}</span>
                            </Tag>
                            <div className="hidden group-hover:flex gap-0.5">
                              <button
                                className="w-4 h-4 rounded flex items-center justify-center text-slate-400 hover:text-primary transition-colors"
                                onClick={() => openTagModal(tag)}
                              >
                                <EditOutlined className="text-[10px]" />
                              </button>
                              <Popconfirm
                                title={t('tags.confirm_delete_tag')}
                                okText={t('common.delete')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}
                                onConfirm={() => deleteTag(tag.id)}
                              >
                                <button className="w-4 h-4 rounded flex items-center justify-center text-slate-400 hover:text-red-400 transition-colors">
                                  <DeleteOutlined className="text-[10px]" />
                                </button>
                              </Popconfirm>
                            </div>
                          </div>
                        )
                      })}
                      {filteredTags.length === 0 && (
                        <p className="text-sm text-slate-400 py-2">{t('tags.no_matching_tags')}</p>
                      )}
                    </div>
                  </div>
                </div>
              ),
            },

            // ── Tab 3: Batch tagging ─────────────────────────────────────────
            {
              key: 'batch',
              label: <span><CheckOutlined className="mr-1" />{t('tags.tab_batch')}</span>,
              children: (
                <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 space-y-4">
                  {/* Batch controls */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <div className="flex-1">
                      <p className="text-xs text-slate-500 mb-1">{t('tags.select_tags_hint')}</p>
                      <Select
                        mode="multiple"
                        placeholder={t('tags.select_tags_placeholder')}
                        value={batchTagIds}
                        onChange={setBatchTagIds}
                        style={{ width: '100%' }}
                        size="small"
                        options={tags.map((tag) => ({
                          value: tag.id,
                          label: <span><Tag color={tag.color} className="text-xs m-0">{tag.name}</Tag></span>,
                        }))}
                      />
                    </div>
                    <Button
                      type="primary" size="small"
                      disabled={!selectedDocs.size || !batchTagIds.length}
                      onClick={applyBatchTags}
                      className="flex-shrink-0"
                    >
                      {t('tags.apply_to_docs', { count: selectedDocs.size || 0 })}
                    </Button>
                  </div>

                  {/* Document list */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Checkbox
                        indeterminate={selectedDocs.size > 0 && selectedDocs.size < MOCK_DOCS.length}
                        checked={selectedDocs.size === MOCK_DOCS.length}
                        onChange={(e) => setSelectedDocs(e.target.checked ? new Set(MOCK_DOCS.map((d) => d.id)) : new Set())}
                      >
                        <span className="text-xs text-slate-500">{t('tags.select_all', { count: MOCK_DOCS.length })}</span>
                      </Checkbox>
                    </div>
                    <div className="space-y-2">
                      {MOCK_DOCS.map((doc) => (
                        <div
                          key={doc.id}
                          className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                            selectedDocs.has(doc.id) ? 'border-primary bg-blue-50/40' : 'border-slate-100 bg-white hover:bg-slate-50'
                          }`}
                          onClick={() => {
                            setSelectedDocs((prev) => {
                              const next = new Set(prev)
                              next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id)
                              return next
                            })
                          }}
                        >
                          <Checkbox checked={selectedDocs.has(doc.id)} onClick={(e) => e.stopPropagation()} />
                          <span className="flex-1 text-sm text-slate-700 truncate">{doc.name}</span>
                          <div className="flex flex-wrap gap-1">
                            {(docTags[doc.id] ?? []).map((tid) => {
                              const tagItem = tags.find((x) => x.id === tid)
                              return tagItem ? <Tag key={tid} color={tagItem.color} className="text-[10px] m-0">{tagItem.name}</Tag> : null
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Category modal */}
      <Modal
        title={catModal.item ? t('tags.edit_cat') : t('tags.new_cat')}
        open={catModal.open}
        onCancel={() => setCatModal({ open: false })}
        footer={null}
        width={420}
      >
        <Form form={catForm} layout="vertical" onFinish={saveCat} className="mt-3">
          {!catModal.item && catModal.parentId && (
            <p className="text-xs text-slate-500 mb-3 p-2 bg-slate-50 rounded-lg">
              {t('tags.parent_cat')}{categories.find((c) => c.id === catModal.parentId)?.name}
            </p>
          )}
          <Form.Item name="name" label={t('tags.cat_name')} rules={[{ required: true, message: t('tags.cat_name_required') }]}>
            <Input placeholder={t('tags.cat_name_placeholder')} />
          </Form.Item>
          <Form.Item name="slug" label={t('tags.cat_slug')} rules={[{ required: true, message: t('tags.cat_slug_required') }, { pattern: /^[a-z0-9-]+$/, message: t('tags.cat_slug_pattern') }]}>
            <Input placeholder={t('tags.cat_slug_placeholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('common.description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCatModal({ open: false })}>{t('common.cancel')}</Button>
            <Button type="primary" htmlType="submit">{t('common.save')}</Button>
          </div>
        </Form>
      </Modal>

      {/* Tag modal */}
      <Modal
        title={tagModal.item ? t('tags.edit_tag') : t('tags.new_tag')}
        open={tagModal.open}
        onCancel={() => setTagModal({ open: false })}
        footer={null}
        width={360}
      >
        <Form form={tagForm} layout="vertical" onFinish={saveTag} className="mt-3">
          <Form.Item name="name" label={t('tags.tag_name')} rules={[{ required: true, message: t('tags.tag_name_required') }]}>
            <Input placeholder={t('tags.tag_name_placeholder')} />
          </Form.Item>
          <Form.Item name="color" label={t('tags.tag_color')} initialValue="#6366f1">
            <ColorPicker showText />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTagModal({ open: false })}>{t('common.cancel')}</Button>
            <Button type="primary" htmlType="submit">{t('common.save')}</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
