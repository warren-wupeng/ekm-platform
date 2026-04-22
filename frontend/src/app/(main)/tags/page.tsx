'use client'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App, Button, Input, Tag, Select, Popconfirm,
  Modal, Form, ColorPicker, Tabs, Checkbox, Tooltip, Spin, Empty,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, TagOutlined,
  ApartmentOutlined, SearchOutlined, CheckOutlined,
  TagsOutlined, FolderOutlined, FolderOpenOutlined,
} from '@ant-design/icons'
import useSWR from 'swr'
import api from '@/lib/api'
import { useKnowledgeList } from '@/lib/useKnowledgeList'
import { useCategories } from '@/lib/useCategories'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: number
  name: string
  slug: string
  parent_id: number | null
  description: string | null
  sort_order: number
  item_count: number
  children: Category[]
}

interface TagItem {
  id: number
  name: string
  color: string | null
  usage_count: number
}

// ── Tags hook ─────────────────────────────────────────────────────────────────

function useTags(search = '') {
  const { data, isLoading, mutate } = useSWR<{ tags: TagItem[] }>(
    `tags/list/${search}`,
    () => api.get('/api/v1/tags', { params: search ? { q: search, page_size: 100 } : { page_size: 100 } }).then((r) => r.data),
    { dedupingInterval: 30_000, revalidateOnFocus: false },
  )
  return { tags: data?.tags ?? [], isLoading, mutate }
}

// ── Category tree UI ──────────────────────────────────────────────────────────

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
  parentId: number | null
  level?: number
  onEdit: (c: Category) => void
  onDelete: (id: number) => void
  onAdd: (parentId: number | null) => void
  t: (key: string) => string
}) {
  const nodes = categories.filter((c) => c.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  if (nodes.length === 0 && level > 0) return null

  return (
    <div className={level > 0 ? 'ml-5 border-l border-slate-100 pl-3' : ''}>
      {nodes.map((cat) => {
        const hasChildren = categories.some((c) => c.parent_id === cat.id)
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
              {cat.item_count > 0 && (
                <span className="text-[10px] text-slate-400">{cat.item_count}</span>
              )}
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

  const { categories, isLoading: catsLoading, mutate: mutateCats } = useCategories(false)
  const [tagSearch, setTagSearch] = useState('')
  const { tags, isLoading: tagsLoading, mutate: mutateTags } = useTags(tagSearch)
  const { items: knowledgeDocs } = useKnowledgeList()

  const [catModal, setCatModal] = useState<{ open: boolean; item?: Category; parentId?: number | null }>({ open: false })
  const [tagModal, setTagModal] = useState<{ open: boolean; item?: TagItem }>({ open: false })
  const [catForm] = Form.useForm()
  const [tagForm] = Form.useForm()
  const [saving, setSaving] = useState(false)

  // Batch tagging state
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [batchTagNames, setBatchTagNames] = useState<string[]>([])

  // Flatten the tree for the CategoryTree component
  function flattenTree(cats: Category[]): Category[] {
    const result: Category[] = []
    function walk(nodes: Category[]) {
      for (const n of nodes) {
        result.push(n)
        if (n.children.length > 0) walk(n.children)
      }
    }
    walk(cats)
    return result
  }
  const flatCats = useMemo(() => flattenTree(categories), [categories])

  // ── Category CRUD ─────────────────────────────────────────────────────────

  function openCatModal(item?: Category, parentId?: number | null) {
    if (item) catForm.setFieldsValue({ name: item.name, slug: item.slug, description: item.description ?? '' })
    else catForm.resetFields()
    setCatModal({ open: true, item, parentId: parentId ?? null })
  }

  async function saveCat(values: { name: string; slug: string; description: string }) {
    setSaving(true)
    try {
      if (catModal.item) {
        await api.patch(`/api/v1/categories/${catModal.item.id}`, {
          name: values.name, slug: values.slug, description: values.description,
        })
        message.success(t('tags.cat_updated'))
      } else {
        await api.post('/api/v1/categories', {
          name: values.name, slug: values.slug,
          description: values.description ?? '',
          parent_id: catModal.parentId ?? null,
          sort_order: 0,
        })
        message.success(t('tags.cat_created'))
      }
      await mutateCats()
      setCatModal({ open: false })
    } catch {
      message.error(t('common.error_generic'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteCategory(id: number) {
    try {
      await api.delete(`/api/v1/categories/${id}`)
      await mutateCats()
      message.success(t('tags.cat_deleted'))
    } catch {
      message.error(t('common.error_generic'))
    }
  }

  // ── Tag CRUD ──────────────────────────────────────────────────────────────

  function openTagModal(item?: TagItem) {
    if (item) tagForm.setFieldsValue({ name: item.name, color: item.color ?? '#6366f1' })
    else tagForm.resetFields()
    setTagModal({ open: true, item })
  }

  async function saveTag(values: { name: string; color: string }) {
    const colorStr = typeof values.color === 'object' ? (values.color as any).toHexString?.() ?? '#6366f1' : values.color
    setSaving(true)
    try {
      if (tagModal.item) {
        await api.patch(`/api/v1/tags/${tagModal.item.id}`, { name: values.name, color: colorStr })
        message.success(t('tags.tag_updated'))
      } else {
        await api.post('/api/v1/tags', { name: values.name, color: colorStr })
        message.success(t('tags.tag_created'))
      }
      await mutateTags()
      setTagModal({ open: false })
    } catch {
      message.error(t('common.error_generic'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteTag(id: number) {
    try {
      await api.delete(`/api/v1/tags/${id}`)
      await mutateTags()
      message.success(t('tags.tag_deleted'))
    } catch {
      message.error(t('common.error_generic'))
    }
  }

  // ── Batch tagging ─────────────────────────────────────────────────────────

  async function applyBatchTags() {
    if (!selectedDocs.size) { message.warning(t('tags.select_docs_first')); return }
    if (!batchTagNames.length) { message.warning(t('tags.select_tags_first')); return }
    setSaving(true)
    try {
      await api.post('/api/v1/tags/bulk-bind', {
        tag_names: batchTagNames,
        knowledge_item_ids: Array.from(selectedDocs).map(Number),
      })
      message.success(t('tags.batch_applied', { tagCount: batchTagNames.length, docCount: selectedDocs.size }))
      setSelectedDocs(new Set())
      setBatchTagNames([])
    } catch {
      message.error(t('common.error_generic'))
    } finally {
      setSaving(false)
    }
  }

  const maxUsage = Math.max(...tags.map((t) => t.usage_count), 1)

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
                  <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
                    <p className="text-sm text-slate-500">{t('tags.category_desc')}</p>
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openCatModal()}>
                      {t('tags.add_category')}
                    </Button>
                  </div>
                  {catsLoading ? (
                    <div className="py-10 flex justify-center"><Spin /></div>
                  ) : (
                    <CategoryTree
                      categories={flatCats}
                      parentId={null}
                      onEdit={(c) => openCatModal(c)}
                      onDelete={deleteCategory}
                      onAdd={(pid) => openCatModal(undefined, pid)}
                      t={t}
                    />
                  )}
                </div>
              ),
            },

            // ── Tab 2: Tags ──────────────────────────────────────────────────
            {
              key: 'tags',
              label: <span><TagOutlined className="mr-1" />{t('tags.tab_tags')}</span>,
              children: (
                <div className="space-y-4">
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

                    {tagsLoading ? (
                      <div className="py-10 flex justify-center"><Spin /></div>
                    ) : tags.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-4" description={t('tags.no_matching_tags')} />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {tags.map((tag) => {
                          const sizeRem = 0.75 + (tag.usage_count / maxUsage) * 0.5
                          return (
                            <div key={tag.id} className="group flex items-center gap-1">
                              <Tag
                                color={tag.color ?? undefined}
                                style={{ fontSize: `${sizeRem}rem`, cursor: 'default', userSelect: 'none' }}
                                className="m-0"
                              >
                                {tag.name}
                                <span style={{ fontSize: '0.65rem', opacity: 0.7, marginLeft: 3 }}>{tag.usage_count}</span>
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
                      </div>
                    )}
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
                        mode="tags"
                        placeholder={t('tags.select_tags_placeholder')}
                        value={batchTagNames}
                        onChange={setBatchTagNames}
                        style={{ width: '100%' }}
                        size="small"
                        options={tags.map((tag) => ({
                          value: tag.name,
                          label: <span><Tag color={tag.color ?? undefined} className="text-xs m-0">{tag.name}</Tag></span>,
                        }))}
                      />
                    </div>
                    <Button
                      type="primary" size="small"
                      disabled={!selectedDocs.size || !batchTagNames.length}
                      loading={saving}
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
                        indeterminate={selectedDocs.size > 0 && selectedDocs.size < knowledgeDocs.length}
                        checked={knowledgeDocs.length > 0 && selectedDocs.size === knowledgeDocs.length}
                        onChange={(e) => setSelectedDocs(e.target.checked ? new Set(knowledgeDocs.map((d) => d.id)) : new Set())}
                      >
                        <span className="text-xs text-slate-500">{t('tags.select_all', { count: knowledgeDocs.length })}</span>
                      </Checkbox>
                    </div>
                    <div className="space-y-2">
                      {knowledgeDocs.map((doc) => (
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
                            {(doc.tags ?? []).slice(0, 3).map((tagName) => (
                              <Tag key={tagName} className="text-[10px] m-0">{tagName}</Tag>
                            ))}
                          </div>
                        </div>
                      ))}
                      {knowledgeDocs.length === 0 && (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-4" />
                      )}
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
          {!catModal.item && catModal.parentId != null && (
            <p className="text-xs text-slate-500 mb-3 p-2 bg-slate-50 rounded-lg">
              {t('tags.parent_cat')}{flatCats.find((c) => c.id === catModal.parentId)?.name}
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
            <Button type="primary" htmlType="submit" loading={saving}>{t('common.save')}</Button>
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
            <Button type="primary" htmlType="submit" loading={saving}>{t('common.save')}</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
