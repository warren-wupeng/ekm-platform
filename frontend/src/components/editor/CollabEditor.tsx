'use client'

import { useEffect, useMemo, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

/**
 * Hash a username to a stable colour from a small palette.
 * Deterministic so the same user always gets the same colour.
 */
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

interface CollabEditorProps {
  /** Yjs document room name, e.g. "doc:item_id" */
  roomName: string
  /** Current user's display name */
  userName: string
  /** Hocuspocus WebSocket URL (from NEXT_PUBLIC_COLLAB_URL) */
  collabUrl: string
  /** JWT token for Hocuspocus auth */
  token?: string
  /** Called when online user list changes */
  onUsersChange?: (users: CollabUser[]) => void
  /** Called on every content update (debounced externally) */
  onContentUpdate?: (html: string) => void
  /** Placeholder when doc is empty */
  placeholder?: string
}

export default function CollabEditor({
  roomName,
  userName,
  collabUrl,
  token,
  onUsersChange,
  onContentUpdate,
  placeholder,
}: CollabEditorProps) {
  const ydoc = useMemo(() => new Y.Doc(), [roomName])

  const provider = useMemo(() => {
    return new HocuspocusProvider({
      url: collabUrl,
      name: roomName,
      document: ydoc,
      token: token ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabUrl, roomName, ydoc, token])

  // Track online users via awareness
  useEffect(() => {
    if (!onUsersChange) return
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
      // Deduplicate by name (same user in multiple tabs)
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

  const cursorColor = useMemo(() => hashColor(userName), [userName])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false, // Yjs handles undo/redo
      }),
      Collaboration.configure({
        document: ydoc,
      }),
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
    onUpdate: ({ editor: ed }) => {
      onContentUpdate?.(ed.getHTML())
    },
  })

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

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
        /* Collaboration cursor styles */
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
