import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIStore {
  sidebarExpanded: boolean
  toggleSidebar: () => void
  setSidebarExpanded: (v: boolean) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
    }),
    { name: 'ekm_ui' }
  )
)
