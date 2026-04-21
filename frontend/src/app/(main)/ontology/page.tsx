'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App, Table, Tag, Button, Modal, Form, Input, Select, Space,
  Tabs, Tooltip, Popconfirm, Tree, Badge,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { DataNode } from 'antd/es/tree'
import {
  PlusOutlined, DeleteOutlined, EditOutlined,
  DownloadOutlined, UploadOutlined, ApartmentOutlined,
  LinkOutlined, TagOutlined,
} from '@ant-design/icons'

interface EntityType {
  id: string
  name: string
  displayName: string
  parent?: string
  source: 'schema.org' | 'custom'
  description: string
  propertyCount: number
  usageCount: number
  color: string
}

interface RelationType {
  id: string
  name: string
  displayName: string
  domain: string
  range: string
  source: 'schema.org' | 'custom'
  description: string
  usageCount: number
}

const ENTITY_COLORS = ['#7c3aed', '#2563eb', '#16a34a', '#dc2626', '#ea580c', '#ca8a04', '#0891b2']

const MOCK_ENTITIES: EntityType[] = [
  { id: 'e1', name: 'Thing',        displayName: '事物',      source: 'schema.org', description: '所有实体的根类型',   propertyCount: 5,  usageCount: 0,   color: '#7c3aed' },
  { id: 'e2', name: 'Person',       displayName: '人物',      parent: 'Thing', source: 'schema.org', description: '表示人或人物',        propertyCount: 12, usageCount: 234, color: '#2563eb' },
  { id: 'e3', name: 'Organization', displayName: '组织',      parent: 'Thing', source: 'schema.org', description: '公司、机构等组织实体', propertyCount: 10, usageCount: 89,  color: '#16a34a' },
  { id: 'e4', name: 'Product',      displayName: '产品',      parent: 'Thing', source: 'schema.org', description: '产品或服务',           propertyCount: 8,  usageCount: 156, color: '#ea580c' },
  { id: 'e5', name: 'Technology',   displayName: '技术',      parent: 'Thing', source: 'custom',     description: '技术、框架、工具',     propertyCount: 6,  usageCount: 312, color: '#0891b2' },
  { id: 'e6', name: 'Project',      displayName: '项目',      parent: 'Thing', source: 'custom',     description: '研发或业务项目',       propertyCount: 7,  usageCount: 198, color: '#ca8a04' },
  { id: 'e7', name: 'Document',     displayName: '文档',      parent: 'Thing', source: 'custom',     description: '知识库文档',           propertyCount: 9,  usageCount: 445, color: '#dc2626' },
  { id: 'e8', name: 'Employee',     displayName: '员工',      parent: 'Person', source: 'custom',    description: '公司员工',             propertyCount: 8,  usageCount: 67,  color: '#7c3aed' },
]

const MOCK_RELATIONS: RelationType[] = [
  { id: 'r1', name: 'worksFor',     displayName: '就职于',    domain: 'Person',   range: 'Organization', source: 'schema.org', description: '人员隶属组织', usageCount: 89  },
  { id: 'r2', name: 'knows',        displayName: '认识',      domain: 'Person',   range: 'Person',       source: 'schema.org', description: '人员互相认识', usageCount: 34  },
  { id: 'r3', name: 'uses',         displayName: '使用',      domain: 'Project',  range: 'Technology',   source: 'custom',     description: '项目使用技术', usageCount: 213 },
  { id: 'r4', name: 'mentions',     displayName: '提及',      domain: 'Document', range: 'Technology',   source: 'custom',     description: '文档提及技术', usageCount: 567 },
  { id: 'r5', name: 'owns',         displayName: '负责',      domain: 'Person',   range: 'Project',      source: 'custom',     description: '人员负责项目', usageCount: 45  },
  { id: 'r6', name: 'partOf',       displayName: '属于',      domain: 'Project',  range: 'Organization', source: 'custom',     description: '项目属于组织', usageCount: 78  },
]

function buildTree(entities: EntityType[]): DataNode[] {
  const map = new Map<string, DataNode & { children: DataNode[] }>()
  const roots: DataNode[] = []

  entities.forEach((e) => {
    map.set(e.name, {
      key: e.id,
      title: (
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: e.color }} />
          <span className="text-sm text-slate-700">{e.displayName}</span>
          <span className="text-xs text-slate-400">({e.name})</span>
          {e.source === 'custom' && <Tag color="purple" className="text-[10px] m-0 px-1">自定义</Tag>}
        </span>
      ),
      children: [],
    })
  })

  entities.forEach((e) => {
    const node = map.get(e.name)!
    if (e.parent && map.has(e.parent)) {
      map.get(e.parent)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  return roots
}

export default function OntologyPage() {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [entities, setEntities]   = useState<EntityType[]>(MOCK_ENTITIES)
  const [relations, setRelations] = useState<RelationType[]>(MOCK_RELATIONS)
  const [activeTab, setActiveTab] = useState('entity')
  const [entityModal, setEntityModal]   = useState<EntityType | null | 'new'>(null)
  const [relationModal, setRelationModal] = useState<RelationType | null | 'new'>(null)
  const [entityForm] = Form.useForm()
  const [relationForm] = Form.useForm()

  function handleSaveEntity(values: Partial<EntityType>) {
    if (entityModal === 'new') {
      const newEntity: EntityType = {
        id: `e${Date.now()}`,
        name: values.name!,
        displayName: values.displayName!,
        parent: values.parent,
        source: 'custom',
        description: values.description ?? '',
        propertyCount: 0,
        usageCount: 0,
        color: ENTITY_COLORS[entities.length % ENTITY_COLORS.length],
      }
      setEntities((prev) => [...prev, newEntity])
      message.success(t('ontology.entity_created'))
    } else if (entityModal) {
      setEntities((prev) =>
        prev.map((e) => e.id === entityModal.id ? { ...e, ...values } : e)
      )
      message.success(t('ontology.entity_updated'))
    }
    setEntityModal(null)
    entityForm.resetFields()
  }

  function handleSaveRelation(values: Partial<RelationType>) {
    if (relationModal === 'new') {
      const newRel: RelationType = {
        id: `r${Date.now()}`,
        name: values.name!,
        displayName: values.displayName!,
        domain: values.domain!,
        range: values.range!,
        source: 'custom',
        description: values.description ?? '',
        usageCount: 0,
      }
      setRelations((prev) => [...prev, newRel])
      message.success(t('ontology.relation_created'))
    } else if (relationModal) {
      setRelations((prev) =>
        prev.map((r) => r.id === (relationModal as RelationType).id ? { ...r, ...values } : r)
      )
      message.success(t('ontology.relation_updated'))
    }
    setRelationModal(null)
    relationForm.resetFields()
  }

  function openEditEntity(entity: EntityType) {
    entityForm.setFieldsValue(entity)
    setEntityModal(entity)
  }

  function openEditRelation(rel: RelationType) {
    relationForm.setFieldsValue(rel)
    setRelationModal(rel)
  }

  const entityColumns: ColumnsType<EntityType> = [
    {
      title: t('ontology.col_entity_type'),
      key: 'name',
      render: (_, r) => (
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: r.color }} />
          <div>
            <span className="text-sm font-medium text-slate-700">{r.displayName}</span>
            <span className="text-xs text-slate-400 ml-2">{r.name}</span>
          </div>
        </div>
      ),
    },
    {
      title: t('ontology.col_parent'),
      dataIndex: 'parent',
      key: 'parent',
      width: 110,
      render: (v?: string) => v ? <Tag className="text-xs">{v}</Tag> : <span className="text-slate-300 text-xs">—</span>,
    },
    {
      title: t('ontology.col_source'),
      dataIndex: 'source',
      key: 'source',
      width: 90,
      render: (s: string) => (
        <Tag color={s === 'custom' ? 'purple' : 'blue'} className="text-xs">
          {s === 'custom' ? t('ontology.source_custom') : 'schema.org'}
        </Tag>
      ),
    },
    {
      title: t('ontology.col_properties'),
      dataIndex: 'propertyCount',
      key: 'propertyCount',
      width: 70,
      align: 'center',
      render: (v: number) => <span className="text-slate-500 text-xs">{v}</span>,
    },
    {
      title: t('ontology.col_usage'),
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      align: 'center',
      render: (v: number) => <Badge count={v} color="geekblue" overflowCount={999} />,
      sorter: (a, b) => a.usageCount - b.usageCount,
    },
    {
      title: t('ontology.col_description'),
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: t('ontology.col_actions'),
      key: 'actions',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title={t('common.edit')}>
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              className="text-slate-400 hover:text-primary"
              onClick={() => openEditEntity(record)}
              disabled={record.source === 'schema.org'}
            />
          </Tooltip>
          <Popconfirm
            title={t('ontology.confirm_delete')}
            description={t('ontology.delete_entity_desc')}
            onConfirm={() => { setEntities((prev) => prev.filter((e) => e.id !== record.id)); message.success(t('ontology.deleted')) }}
            okText={t('common.delete')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}
            disabled={record.source === 'schema.org'}
          >
            <Tooltip title={record.source === 'schema.org' ? t('ontology.system_no_delete') : t('common.delete')}>
              <Button
                type="text" size="small"
                icon={<DeleteOutlined />}
                className="text-slate-400 hover:text-red-500"
                disabled={record.source === 'schema.org'}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const relationColumns: ColumnsType<RelationType> = [
    {
      title: t('ontology.col_relation_name'),
      key: 'name',
      render: (_, r) => (
        <div>
          <span className="text-sm font-medium text-slate-700">{r.displayName}</span>
          <span className="text-xs text-slate-400 ml-2">{r.name}</span>
        </div>
      ),
    },
    {
      title: t('ontology.col_domain_range'),
      key: 'domain',
      width: 180,
      render: (_, r) => (
        <span className="text-xs">
          <Tag className="text-xs">{r.domain}</Tag>
          <span className="text-slate-400 mx-1">→</span>
          <Tag className="text-xs">{r.range}</Tag>
        </span>
      ),
    },
    {
      title: t('ontology.col_source'),
      dataIndex: 'source',
      key: 'source',
      width: 90,
      render: (s: string) => (
        <Tag color={s === 'custom' ? 'purple' : 'blue'} className="text-xs">
          {s === 'custom' ? t('ontology.source_custom') : 'schema.org'}
        </Tag>
      ),
    },
    {
      title: t('ontology.col_usage'),
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      align: 'center',
      render: (v: number) => <Badge count={v} color="geekblue" overflowCount={999} />,
      sorter: (a, b) => a.usageCount - b.usageCount,
    },
    {
      title: t('ontology.col_description'),
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: t('ontology.col_actions'),
      key: 'actions',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title={t('common.edit')}>
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              className="text-slate-400 hover:text-primary"
              onClick={() => openEditRelation(record)}
              disabled={record.source === 'schema.org'}
            />
          </Tooltip>
          <Popconfirm
            title={t('ontology.confirm_delete')}
            description={t('ontology.delete_relation_desc')}
            onConfirm={() => { setRelations((prev) => prev.filter((r) => r.id !== record.id)); message.success(t('ontology.deleted')) }}
            okText={t('common.delete')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}
            disabled={record.source === 'schema.org'}
          >
            <Tooltip title={record.source === 'schema.org' ? t('ontology.system_no_delete') : t('common.delete')}>
              <Button
                type="text" size="small"
                icon={<DeleteOutlined />}
                className="text-slate-400 hover:text-red-500"
                disabled={record.source === 'schema.org'}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const treeData = buildTree(entities)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ApartmentOutlined className="text-slate-500 text-lg" />
              <h1 className="text-lg font-semibold text-slate-800">{t('ontology.page_title')}</h1>
            </div>
            <p className="text-xs text-slate-400">{t('ontology.page_subtitle')}</p>
          </div>
          <Space>
            <Button size="small" icon={<UploadOutlined />} className="text-slate-600">
              {t('ontology.import')}
            </Button>
            <Button size="small" icon={<DownloadOutlined />} className="text-slate-600">
              {t('ontology.export')}
            </Button>
          </Space>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-5">
        <div className="flex gap-5">
          {/* Left: Type hierarchy tree */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className="flex items-center gap-2 mb-3">
                <ApartmentOutlined className="text-slate-400 text-sm" />
                <span className="text-sm font-medium text-slate-700">{t('ontology.type_hierarchy')}</span>
              </div>
              <Tree
                treeData={treeData}
                defaultExpandAll
                showLine={{ showLeafIcon: false }}
                className="text-xs"
              />
            </div>
          </div>

          {/* Right: Tables */}
          <div className="flex-1 min-w-0">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              tabBarExtraContent={
                activeTab === 'entity' ? (
                  <Button
                    size="small" type="primary" icon={<PlusOutlined />}
                    onClick={() => { entityForm.resetFields(); setEntityModal('new') }}
                  >
                    {t('ontology.add_entity')}
                  </Button>
                ) : (
                  <Button
                    size="small" type="primary" icon={<PlusOutlined />}
                    onClick={() => { relationForm.resetFields(); setRelationModal('new') }}
                  >
                    {t('ontology.add_relation')}
                  </Button>
                )
              }
              items={[
                {
                  key: 'entity',
                  label: <span><TagOutlined className="mr-1" />{t('ontology.tab_entities', { count: entities.length })}</span>,
                  children: (
                    <div className="bg-white rounded-2xl border border-slate-100 p-4">
                      <Table
                        dataSource={entities}
                        columns={entityColumns}
                        rowKey="id"
                        size="small"
                        pagination={false}
                      />
                    </div>
                  ),
                },
                {
                  key: 'relation',
                  label: <span><LinkOutlined className="mr-1" />{t('ontology.tab_relations', { count: relations.length })}</span>,
                  children: (
                    <div className="bg-white rounded-2xl border border-slate-100 p-4">
                      <Table
                        dataSource={relations}
                        columns={relationColumns}
                        rowKey="id"
                        size="small"
                        pagination={false}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Entity type modal */}
      <Modal
        title={entityModal === 'new' ? t('ontology.new_entity') : t('ontology.edit_entity')}
        open={!!entityModal}
        onCancel={() => { setEntityModal(null); entityForm.resetFields() }}
        footer={null}
      >
        <Form form={entityForm} layout="vertical" onFinish={handleSaveEntity} className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="name" label={t('ontology.identifier')} rules={[{ required: true }]}>
              <Input placeholder="e.g. Department" />
            </Form.Item>
            <Form.Item name="displayName" label={t('ontology.display_name')} rules={[{ required: true }]}>
              <Input placeholder={t('ontology.display_name_placeholder_entity')} />
            </Form.Item>
          </div>
          <Form.Item name="parent" label={t('ontology.parent_optional')}>
            <Select
              allowClear
              placeholder={t('ontology.select_parent')}
              options={entities.map((e) => ({ label: `${e.displayName} (${e.name})`, value: e.name }))}
            />
          </Form.Item>
          <Form.Item name="description" label={t('ontology.col_description')}>
            <Input.TextArea rows={2} placeholder={t('ontology.desc_placeholder_entity')} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setEntityModal(null); entityForm.resetFields() }}>{t('common.cancel')}</Button>
            <Button type="primary" htmlType="submit">{t('common.save')}</Button>
          </div>
        </Form>
      </Modal>

      {/* Relation type modal */}
      <Modal
        title={relationModal === 'new' ? t('ontology.new_relation') : t('ontology.edit_relation')}
        open={!!relationModal}
        onCancel={() => { setRelationModal(null); relationForm.resetFields() }}
        footer={null}
      >
        <Form form={relationForm} layout="vertical" onFinish={handleSaveRelation} className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="name" label={t('ontology.identifier')} rules={[{ required: true }]}>
              <Input placeholder="e.g. belongsTo" />
            </Form.Item>
            <Form.Item name="displayName" label={t('ontology.display_name')} rules={[{ required: true }]}>
              <Input placeholder={t('ontology.display_name_placeholder_relation')} />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="domain" label={t('ontology.domain_label')} rules={[{ required: true }]}>
              <Select
                placeholder={t('ontology.domain_placeholder')}
                options={entities.map((e) => ({ label: `${e.displayName} (${e.name})`, value: e.name }))}
              />
            </Form.Item>
            <Form.Item name="range" label={t('ontology.range_label')} rules={[{ required: true }]}>
              <Select
                placeholder={t('ontology.range_placeholder')}
                options={entities.map((e) => ({ label: `${e.displayName} (${e.name})`, value: e.name }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="description" label={t('ontology.col_description')}>
            <Input.TextArea rows={2} placeholder={t('ontology.desc_placeholder_relation')} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setRelationModal(null); relationForm.resetFields() }}>{t('common.cancel')}</Button>
            <Button type="primary" htmlType="submit">{t('common.save')}</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
