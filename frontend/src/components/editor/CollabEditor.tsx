'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { yCursorPlugin, defaultSelectionBuilder } from '@tiptap/y-tiptap'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

const CURSOR_COLORS = [
  '#f56565', '#ed8936', '#ecc94b', '#48bb78',
  '#38b2ac', '#4299e1', '#667eea', '#9f7aea',
  '#ed64a6', '#fc8181', '#f6ad55', '#68d391',
]

function hashColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0
  }
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length]
}

export interface CollabUser {
  name: string
  color: string
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface CollabEditorProps {
  roomName: string
  userName: string
  collabUrl: string
  /** JWT token for Hocuspocus onAuthenticate — REQUIRED for room access */
  token: string
  onUsersChange?: (users: CollabUser[]) => void
  onConnectionChange?: (status: ConnectionStatus) => void
  placeholder?: string
}

interface CollabResources {
  key: string
  provider: HocuspocusProvider
  ydoc: Y.Doc
}

interface CollabEditorContentProps {
  provider: HocuspocusProvider
  ydoc: Y.Doc
  userName: string
  cursorColor: string
  placeholder?: string
}

interface AwarenessUserState {
  name?: string
  color?: string
}

function destroyResources(resources: CollabResources) {
  resources.provider.destroy()
  resources.ydoc.destroy()
}

function makeCursorExtension(
  provider: HocuspocusProvider,
  user: { name: string; color: string },
) {
  return Extension.create({
    name: 'collaborationCursor',
    addProseMirrorPlugins() {
      const awareness = provider.awareness!
      awareness.setLocalStateField('user', user)
      return [
        yCursorPlugin(awareness, {
          cursorBuilder: (u: { name?: string; color?: string }) => {
            const cursor = document.createElement('span')
            cursor.classList.add('collaboration-cursor__caret')
            cursor.setAttribute('style', `border-color: ${u.color}`)
            const label = document.createElement('div')
            label.classList.add('collaboration-cursor__label')
            label.setAttribute('style', `background-color: ${u.color}`)
            label.insertBefore(document.createTextNode(u.name ?? ''), null)
            cursor.insertBefore(label, null)
            return cursor
          },
          selectionBuilder: defaultSelectionBuilder,
        }),
      ]
    },
  })
}

function CollabEditorContent({
  provider,
  ydoc,
  userName,
  cursorColor,
  placeholder,
}: CollabEditorContentProps) {
  const cursorExt = useMemo(
    () => makeCursorExtension(provider, { name: userName, color: cursorColor }),
    [provider, userName, cursorColor],
  )

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ydoc }),
        cursorExt,
      ],
      editorProps: {
        attributes: {
          class:
            'prose prose-sm max-w-none h-full px-6 py-4 focus:outline-none text-slate-700 leading-relaxed',
          'data-placeholder': placeholder ?? '',
        },
      },
    },
    [provider, ydoc, userName, cursorColor, placeholder],
  )

  return <EditorContent editor={editor} className="h-full" />
}

export default function CollabEditor({
  roomName,
  userName,
  collabUrl,
  token,
  onUsersChange,
  onConnectionChange,
  placeholder,
}: CollabEditorProps) {
  const cursorColor = useMemo(() => hashColor(userName), [userName])
  const connectionKey = `${roomName}::${collabUrl}::${token}`
  const resourcesRef = useRef<CollabResources | null>(null)
  const onConnectionChangeRef = useRef(onConnectionChange)
  const onUsersChangeRef = useRef(onUsersChange)

  onConnectionChangeRef.current = onConnectionChange
  onUsersChangeRef.current = onUsersChange

  let resources = resourcesRef.current

  if (!resources || resources.key !== connectionKey) {
    if (resources) {
      destroyResources(resources)
    }

    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: roomName,
      document: ydoc,
      token,
      onStatus: ({ status }: { status: string }) => {
        onConnectionChangeRef.current?.(status as ConnectionStatus)
      },
    })

    resources = {
      key: connectionKey,
      provider,
      ydoc,
    }

    resourcesRef.current = resources
  }

  useEffect(() => {
    return () => {
      if (resourcesRef.current) {
        destroyResources(resourcesRef.current)
        resourcesRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const awareness = resources.provider.awareness

    function updateUsers() {
      const states = awareness?.getStates()
      if (!states) return

      const users: CollabUser[] = []
      states.forEach((state) => {
        const user = (state as { user?: AwarenessUserState }).user
        if (typeof user?.name === 'string') {
          users.push({
            name: user.name,
            color: typeof user.color === 'string' ? user.color : hashColor(user.name),
          })
        }
      })

      const seen = new Set<string>()
      const unique = users.filter((user) => {
        if (seen.has(user.name)) return false
        seen.add(user.name)
        return true
      })

      onUsersChangeRef.current?.(unique)
    }

    awareness?.on('change', updateUsers)
    updateUsers()

    return () => {
      awareness?.off('change', updateUsers)
    }
  }, [resources])

  return (
    <div className="flex-1 overflow-y-auto bg-white collab-editor">
      <CollabEditorContent
        key={connectionKey}
        provider={resources.provider}
        ydoc={resources.ydoc}
        userName={userName}
        cursorColor={cursorColor}
        placeholder={placeholder}
      />
      <style jsx global>{`
        .collab-editor .ProseMirror {
          min-height: 100%;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .collab-editor .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
        }
        .collaboration-cursor__caret {
          border-left: 1px solid;
          border-right: 1px solid;
          margin-left: -1px;
          margin-right: -1px;
          pointer-events: none;
          position: relative;
          word-break: normal;
        }
        .collaboration-cursor__label {
          border-radius: 3px 3px 3px 0;
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          left: -1px;
          line-height: normal;
          padding: 0.1rem 0.3rem;
          position: absolute;
          top: -1.4em;
          user-select: none;
          white-space: nowrap;
        }
      `}</style>
    </div>
  )
}
