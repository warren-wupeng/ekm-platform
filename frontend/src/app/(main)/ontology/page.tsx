'use client'
import { useState } from 'react'
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
      message.success('实体类型已创建')
    } else if (entityModal) {
      setEntities((prev) =>
        prev.map((e) => e.id === entityModal.id ? { ...e, ...values } : e)
      )
      message.success('实体类型已更新')
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
      message.success('关系类型已创建')
    } else if (relationModal) {
      setRelations((prev) =>
        prev.map((r) => r.id === (relationModal as RelationType).id ? { ...r, ...values } : r)
      )
      message.success('关系类型已更新')
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
      title: '实体类型',
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
      title: '父类',
      dataIndex: 'parent',
      key: 'parent',
      width: 110,
      render: (v?: string) => v ? <Tag className="text-xs">{v}</Tag> : <span className="text-slate-300 text-xs">—</span>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 90,
      render: (s: string) => (
        <Tag color={s === 'custom' ? 'purple' : 'blue'} className="text-xs">
          {s === 'custom' ? '自定义' : 'schema.org'}
        </Tag>
      ),
    },
    {
      title: '属性数',
      dataIndex: 'propertyCount',
      key: 'propertyCount',
      width: 70,
      align: 'center',
      render: (v: number) => <span className="text-slate-500 text-xs">{v}</span>,
    },
    {
      title: '使用次数',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      align: 'center',
      render: (v: number) => <Badge count={v} color="geekblue" overflowCount={999} />,
      sorter: (a, b) => a.usageCount - b.usageCount,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              className="text-slate-400 hover:text-primary"
              onClick={() => openEditEntity(record)}
              disabled={record.source === 'schema.org'}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除"
            description="删除此实体类型不会影响已有数据"
            onConfirm={() => { setEntities((prev) => prev.filter((e) => e.id !== record.id)); message.success('已删除') }}
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
            disabled={record.source === 'schema.org'}
          >
            <Tooltip title={record.source === 'schema.org' ? '系统类型不可删除' : '删除'}>
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
      title: '关系名',
      key: 'name',
      render: (_, r) => (
        <div>
          <span className="text-sm font-medium text-slate-700">{r.displayName}</span>
          <span className="text-xs text-slate-400 ml-2">{r.name}</span>
        </div>
      ),
    },
    {
      title: '域 → 值域',
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
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 90,
      render: (s: string) => (
        <Tag color={s === 'custom' ? 'purple' : 'blue'} className="text-xs">
          {s === 'custom' ? '自定义' : 'schema.org'}
        </Tag>
      ),
    },
    {
      title: '使用次数',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      align: 'center',
      render: (v: number) => <Badge count={v} color="geekblue" overflowCount={999} />,
      sorter: (a, b) => a.usageCount - b.usageCount,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              className="text-slate-400 hover:text-primary"
              onClick={() => openEditRelation(record)}
              disabled={record.source === 'schema.org'}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除"
            description="删除关系类型不影响已有 KG 数据"
            onConfirm={() => { setRelations((prev) => prev.filter((r) => r.id !== record.id)); message.success('已删除') }}
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
            disabled={record.source === 'schema.org'}
          >
            <Tooltip title={record.source === 'schema.org' ? '系统类型不可删除' : '删除'}>
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
              <h1 className="text-lg font-semibold text-slate-800">Ontology 管理</h1>
            </div>
            <p className="text-xs text-slate-400">基于 schema.org，支持自定义类型扩展</p>
          </div>
          <Space>
            <Button size="small" icon={<UploadOutlined />} className="text-slate-600">
              导入 Ontology
            </Button>
            <Button size="small" icon={<DownloadOutlined />} className="text-slate-600">
              导出 JSON-LD
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
                <span className="text-sm font-medium text-slate-700">类型层级</span>
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
                    新增实体类型
                  </Button>
                ) : (
                  <Button
                    size="small" type="primary" icon={<PlusOutlined />}
                    onClick={() => { relationForm.resetFields(); setRelationModal('new') }}
                  >
                    新增关系类型
                  </Button>
                )
              }
              items={[
                {
                  key: 'entity',
                  label: <span><TagOutlined className="mr-1" />实体类型 ({entities.length})</span>,
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
                  label: <span><LinkOutlined className="mr-1" />关系类型 ({relations.length})</span>,
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
        title={entityModal === 'new' ? '新增实体类型' : '编辑实体类型'}
        open={!!entityModal}
        onCancel={() => { setEntityModal(null); entityForm.resetFields() }}
        footer={null}
      >
        <Form form={entityForm} layout="vertical" onFinish={handleSaveEntity} className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="name" label="英文标识符" rules={[{ required: true }]}>
              <Input placeholder="e.g. Department" />
            </Form.Item>
            <Form.Item name="displayName" label="中文名称" rules={[{ required: true }]}>
              <Input placeholder="e.g. 部门" />
            </Form.Item>
          </div>
          <Form.Item name="parent" label="父类（可选）">
            <Select
              allowClear
              placeholder="选择父类"
              options={entities.map((e) => ({ label: `${e.displayName} (${e.name})`, value: e.name }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="描述此实体类型的含义和用途" />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setEntityModal(null); entityForm.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">保存</Button>
          </div>
        </Form>
      </Modal>

      {/* Relation type modal */}
      <Modal
        title={relationModal === 'new' ? '新增关系类型' : '编辑关系类型'}
        open={!!relationModal}
        onCancel={() => { setRelationModal(null); relationForm.resetFields() }}
        footer={null}
      >
        <Form form={relationForm} layout="vertical" onFinish={handleSaveRelation} className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="name" label="英文标识符" rules={[{ required: true }]}>
              <Input placeholder="e.g. belongsTo" />
            </Form.Item>
            <Form.Item name="displayName" label="中文名称" rules={[{ required: true }]}>
              <Input placeholder="e.g. 归属于" />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="domain" label="域（起点实体）" rules={[{ required: true }]}>
              <Select
                placeholder="选择起点实体类型"
                options={entities.map((e) => ({ label: `${e.displayName} (${e.name})`, value: e.name }))}
              />
            </Form.Item>
            <Form.Item name="range" label="值域（终点实体）" rules={[{ required: true }]}>
              <Select
                placeholder="选择终点实体类型"
                options={entities.map((e) => ({ label: `${e.displayName} (${e.name})`, value: e.name }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="描述此关系的含义" />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setRelationModal(null); relationForm.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">保存</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
