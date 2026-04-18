'use client'
import { useState, useCallback, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
  useReactFlow,
  Panel,
} from '@xyflow/react'
import type { Node, Edge, Connection, NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Button, Input, Drawer, Descriptions, Tag, Tooltip, Select,
  Space, Popconfirm, message, Modal, Form,
} from 'antd'
import {
  SearchOutlined, PlusOutlined, DeleteOutlined,
  ReloadOutlined, ApartmentOutlined, EditOutlined,
} from '@ant-design/icons'

interface EntityData {
  label: string
  type: string
  color: string
  properties: Record<string, string>
  [key: string]: unknown
}

const TYPE_COLOR: Record<string, string> = {
  Person:       '#2563eb',
  Organization: '#16a34a',
  Technology:   '#0891b2',
  Project:      '#ea580c',
  Document:     '#dc2626',
  Product:      '#7c3aed',
}
function typeColor(t: string) { return TYPE_COLOR[t] ?? '#64748b' }

function EntityNode({ data, selected }: { data: EntityData; selected: boolean }) {
  const color = data.color ?? typeColor(data.type)
  return (
    <div
      className="rounded-xl border-2 transition-shadow"
      style={{
        background: '#fff',
        borderColor: selected ? color : '#e2e8f0',
        boxShadow: selected ? `0 0 0 2px ${color}40` : '0 1px 4px rgba(0,0,0,0.08)',
        minWidth: 120,
        maxWidth: 180,
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ background: color, width: 8, height: 8 }} />
      <div className="rounded-t-[10px] px-3 py-1.5 flex items-center gap-1.5" style={{ background: `${color}18` }}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[10px] font-medium" style={{ color }}>{data.type}</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-sm font-semibold text-slate-800 leading-tight truncate">{data.label}</p>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color, width: 8, height: 8 }} />
    </div>
  )
}
const nodeTypes: NodeTypes = { entity: EntityNode }

const edgeDefaults = {
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: '#94a3b8' },
  labelStyle: { fontSize: 10, fill: '#64748b' },
  labelBgStyle: { fill: '#f8fafc' },
}

const INIT_NODES: Node<EntityData>[] = [
  { id: 'n1',  type: 'entity', position: { x: 100, y: 200 }, data: { label: 'Kira Chen',           type: 'Person',       color: typeColor('Person'),       properties: { role: 'CTO',    email: 'kira@ekm.ai'   } } },
  { id: 'n2',  type: 'entity', position: { x: 100, y: 360 }, data: { label: 'Warren Wu',           type: 'Person',       color: typeColor('Person'),       properties: { role: 'CEO',    email: 'warren@ekm.ai' } } },
  { id: 'n3',  type: 'entity', position: { x: 380, y: 120 }, data: { label: 'EKM Platform',        type: 'Project',      color: typeColor('Project'),      properties: { status: '开发中', since: '2026-01' } } },
  { id: 'n4',  type: 'entity', position: { x: 650, y: 80  }, data: { label: 'Next.js',             type: 'Technology',   color: typeColor('Technology'),   properties: { version: '16',    category: '前端框架' } } },
  { id: 'n5',  type: 'entity', position: { x: 650, y: 200 }, data: { label: 'FastAPI',             type: 'Technology',   color: typeColor('Technology'),   properties: { version: '0.110', category: '后端框架' } } },
  { id: 'n6',  type: 'entity', position: { x: 650, y: 320 }, data: { label: 'Neo4j',               type: 'Technology',   color: typeColor('Technology'),   properties: { version: '5.x',   category: '图数据库' } } },
  { id: 'n7',  type: 'entity', position: { x: 380, y: 360 }, data: { label: '技术架构设计.docx',    type: 'Document',     color: typeColor('Document'),     properties: { version: 'v5',    size: '890KB' } } },
  { id: 'n8',  type: 'entity', position: { x: 380, y: 500 }, data: { label: 'Warren Startup Inc.', type: 'Organization', color: typeColor('Organization'), properties: { size: '10人',     founded: '2025' } } },
  { id: 'n9',  type: 'entity', position: { x: 100, y: 500 }, data: { label: 'Luca Rossi',          type: 'Person',       color: typeColor('Person'),       properties: { role: 'CMO',    email: 'luca@ekm.ai'   } } },
]

const INIT_EDGES: Edge[] = [
  { id: 'e1',  source: 'n1', target: 'n3', label: '负责',   ...edgeDefaults },
  { id: 'e2',  source: 'n2', target: 'n3', label: '负责',   ...edgeDefaults },
  { id: 'e3',  source: 'n3', target: 'n4', label: '使用',   ...edgeDefaults },
  { id: 'e4',  source: 'n3', target: 'n5', label: '使用',   ...edgeDefaults },
  { id: 'e5',  source: 'n3', target: 'n6', label: '使用',   ...edgeDefaults },
  { id: 'e6',  source: 'n1', target: 'n7', label: '创建',   ...edgeDefaults },
  { id: 'e7',  source: 'n7', target: 'n6', label: '提及',   ...edgeDefaults },
  { id: 'e8',  source: 'n1', target: 'n8', label: '就职于', ...edgeDefaults },
  { id: 'e9',  source: 'n2', target: 'n8', label: '就职于', ...edgeDefaults },
  { id: 'e10', source: 'n9', target: 'n8', label: '就职于', ...edgeDefaults },
  { id: 'e11', source: 'n1', target: 'n2', label: '认识',   ...edgeDefaults },
  { id: 'e12', source: 'n3', target: 'n8', label: '属于',   ...edgeDefaults },
]

function KGCanvasInner() {
  const { fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<EntityData>>(INIT_NODES as Node<EntityData>[])
  const [edges, setEdges, onEdgesChange] = useEdgesState(INIT_EDGES)
  const [selectedNode, setSelectedNode] = useState<Node<EntityData> | null>(null)
  const [drawerOpen, setDrawerOpen]     = useState(false)
  const [editModal, setEditModal]       = useState(false)
  const [addModal, setAddModal]         = useState(false)
  const [addForm]  = Form.useForm()
  const [editForm] = Form.useForm()
  const idRef = useRef(INIT_NODES.length + 1)

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, label: '关联', ...edgeDefaults }, eds)),
    [setEdges]
  )

  function onNodeClick(_: React.MouseEvent, node: Node<EntityData>) {
    setSelectedNode(node)
    setDrawerOpen(true)
  }

  function handleDeleteNode() {
    if (!selectedNode) return
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id))
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
    setDrawerOpen(false)
    message.success('节点已删除')
  }

  function handleAddNode(values: { label: string; type: string }) {
    const id = `n${++idRef.current}`
    setNodes((nds) => [
      ...nds,
      {
        id, type: 'entity',
        position: { x: 200 + Math.random() * 300, y: 200 + Math.random() * 200 },
        data: { label: values.label, type: values.type, color: typeColor(values.type), properties: {} },
      },
    ])
    setAddModal(false)
    addForm.resetFields()
    message.success('节点已添加')
  }

  function handleEditNode(values: { label: string; type: string }) {
    if (!selectedNode) return
    const color = typeColor(values.type)
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, ...values, color } }
          : n
      )
    )
    setSelectedNode((prev) => prev ? { ...prev, data: { ...prev.data, ...values, color } } : null)
    setEditModal(false)
    message.success('节点已更新')
  }

  function handleSearch(val: string) {
    const q = val.trim().toLowerCase()
    if (!q) {
      setNodes((nds) => nds.map((n) => ({ ...n, style: {} })))
      return
    }
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        style: n.data.label.toLowerCase().includes(q) || n.data.type.toLowerCase().includes(q)
          ? { opacity: 1 } : { opacity: 0.2 },
      }))
    )
    const match = nodes.find((n) => n.data.label.toLowerCase().includes(q))
    if (match) fitView({ nodes: [match], duration: 400, padding: 0.5 })
  }

  const entityTypes = Object.keys(TYPE_COLOR)

  return (
    <div className="flex-1" style={{ height: 'calc(100vh - 57px)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        style={{ background: '#f8fafc' }}
      >
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.data as EntityData).color ?? '#64748b'}
          style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}
        />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />

        <Panel position="top-left">
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2">
            <Input
              size="small" placeholder="搜索节点…"
              prefix={<SearchOutlined className="text-slate-400 text-xs" />}
              style={{ width: 180 }}
              onChange={(e) => handleSearch(e.target.value)}
              allowClear
            />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddModal(true)}>
              添加节点
            </Button>
            <Tooltip title="重置视图">
              <Button size="small" icon={<ReloadOutlined />} onClick={() => fitView({ duration: 400 })} />
            </Tooltip>
          </div>
        </Panel>

        <Panel position="bottom-left">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(TYPE_COLOR).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1 text-xs text-slate-600">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />{type}
              </span>
            ))}
          </div>
        </Panel>
      </ReactFlow>

      {/* Node detail drawer */}
      <Drawer
        title={<span className="flex items-center gap-2"><ApartmentOutlined className="text-primary" />节点详情</span>}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={300}
        extra={
          <Space>
            <Tooltip title="编辑">
              <Button
                size="small" icon={<EditOutlined />}
                onClick={() => {
                  if (selectedNode) {
                    editForm.setFieldsValue({ label: selectedNode.data.label, type: selectedNode.data.type })
                    setEditModal(true)
                  }
                }}
              />
            </Tooltip>
            <Popconfirm
              title="确认删除节点" description="同时删除此节点的所有关联关系"
              onConfirm={handleDeleteNode} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
            >
              <Tooltip title="删除节点">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        }
      >
        {selectedNode && (
          <div className="space-y-4">
            <div
              className="rounded-xl p-4"
              style={{ background: `${selectedNode.data.color}10`, border: `1px solid ${selectedNode.data.color}30` }}
            >
              <p className="text-lg font-semibold text-slate-800">{selectedNode.data.label}</p>
              <Tag style={{ color: selectedNode.data.color, borderColor: selectedNode.data.color, background: 'transparent' }} className="mt-1 text-xs">
                {selectedNode.data.type}
              </Tag>
            </div>

            {Object.keys(selectedNode.data.properties).length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">属性</p>
                <Descriptions size="small" column={1} bordered>
                  {Object.entries(selectedNode.data.properties).map(([k, v]) => (
                    <Descriptions.Item key={k} label={<span className="text-xs text-slate-500">{k}</span>}>
                      <span className="text-xs text-slate-700">{v}</span>
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">关联关系</p>
              <div className="space-y-1">
                {edges
                  .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                  .map((e) => {
                    const isSource = e.source === selectedNode.id
                    const other = nodes.find((n) => n.id === (isSource ? e.target : e.source))
                    return (
                      <div key={e.id} className="flex items-center gap-2 text-xs text-slate-600 py-1 border-b border-slate-50">
                        {isSource ? (
                          <><Tag className="text-[10px] m-0">{e.label as string}</Tag><span className="text-slate-400">→</span><span className="font-medium">{other?.data.label}</span></>
                        ) : (
                          <><span className="font-medium">{other?.data.label}</span><span className="text-slate-400">→</span><Tag className="text-[10px] m-0">{e.label as string}</Tag></>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* Add node */}
      <Modal title="添加节点" open={addModal} onCancel={() => { setAddModal(false); addForm.resetFields() }} footer={null}>
        <Form form={addForm} layout="vertical" onFinish={handleAddNode} className="mt-4">
          <Form.Item name="label" label="节点名称" rules={[{ required: true }]}>
            <Input placeholder="e.g. Anthropic" />
          </Form.Item>
          <Form.Item name="type" label="实体类型" rules={[{ required: true }]}>
            <Select placeholder="选择类型" options={entityTypes.map((t) => ({ label: t, value: t }))} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setAddModal(false); addForm.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">添加</Button>
          </div>
        </Form>
      </Modal>

      {/* Edit node */}
      <Modal title="编辑节点" open={editModal} onCancel={() => setEditModal(false)} footer={null}>
        <Form form={editForm} layout="vertical" onFinish={handleEditNode} className="mt-4">
          <Form.Item name="label" label="节点名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="实体类型" rules={[{ required: true }]}>
            <Select options={entityTypes.map((t) => ({ label: t, value: t }))} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditModal(false)}>取消</Button>
            <Button type="primary" htmlType="submit">保存</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default function KGCanvas() {
  return (
    <ReactFlowProvider>
      <KGCanvasInner />
    </ReactFlowProvider>
  )
}
