'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
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

  // ── Synchronous Y.Doc + Provider init ──────────────────────────────────────
  // Create Y.Doc and HocuspocusProvider synchronously during the first render
  // so that useEditor ALWAYS receives Collaboration extensions from the start.
  // This avoids the two-phase editor creation (StarterKit-only → reconfigure
  // with Collaboration) that crashes ProseMirror during SPA navigation.
  const collabRef = useRef<{ ydoc: Y.Doc; provider: HocuspocusProvider; key: string } | null>(null)
  const collabKey = `${roomName}::${collabUrl}::${token}`

  if (!collabRef.current || collabRef.current.key !== collabKey) {
    // Tear down previous connection when room/token changes
    if (collabRef.current) {
      collabRef.current.provider.destroy()
      collabRef.current.ydoc.destroy()
    }
    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: roomName,
      document: ydoc,
      token,
      onStatus: ({ status }: { status: string }) => {
        onConnectionChange?.(status as ConnectionStatus)
      },
    })
    collabRef.current = { ydoc, provider, key: collabKey }
  }

  const { ydoc, provider } = collabRef.current

  // Track online users via awareness
  useEffect(() => {
    const awareness = provider.awareness
    function updateUsers() {
      const states = awareness?.getStates()
      if (!states) return
      const users: CollabUser[] = []
      states.forEach((state) => {
        if (state.user?.name) {
          users.push({ name: state.user.name, color: state.user.color })
        }
      })
      const seen = new Set<string>()
      const unique = users.filter((u) => {
        if (seen.has(u.name)) return false
        seen.add(u.name)
        return true
      })
      onUsersChange?.(unique)
    }
    awareness?.on('change', updateUsers)
    updateUsers()
    return () => { awareness?.off('change', updateUsers) }
  }, [provider, onUsersChange])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      collabRef.current?.provider.destroy()
      collabRef.current?.ydoc.destroy()
      collabRef.current = null
    }
  }, [])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider,
          user: { name: userName, color: cursorColor },
        }),
      ],
      editorProps: {
        attributes: {
          class:
            'prose prose-sm max-w-none h-full px-6 py-4 focus:outline-none text-slate-700 leading-relaxed',
          'data-placeholder': placeholder ?? '',
        },
      },
    },
    [collabKey, userName, cursorColor],
  )

  return (
    <div className="flex-1 overflow-y-auto bg-white collab-editor">
      <EditorContent editor={editor} className="h-full" />
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
