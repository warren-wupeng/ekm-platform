'use client'

import { Tooltip, Avatar } from 'antd'
import type { CollabUser } from './CollabEditor'

interface OnlineUsersProps {
  users: CollabUser[]
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

export default function OnlineUsers({ users }: OnlineUsersProps) {
  if (users.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      <Avatar.Group size="small" max={{ count: 5 }}>
        {users.map((u) => (
          <Tooltip key={u.name} title={u.name}>
            <Avatar
              size="small"
              style={{ backgroundColor: u.color, fontSize: 10 }}
            >
              {getInitials(u.name)}
            </Avatar>
          </Tooltip>
        ))}
      </Avatar.Group>
      <span className="text-xs text-slate-400 ml-1">
        {users.length}
      </span>
    </div>
  )
}
