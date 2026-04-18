import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIStore {
  sidebarExpanded: boolean
  mobileSidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarExpanded: (v: boolean) => void
  setMobileSidebarOpen: (v: boolean) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      mobileSidebarOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
      setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
    }),
    {
      name: 'ekm_ui',
      partialize: (s) => ({ sidebarExpanded: s.sidebarExpanded }),
    }
  )
)
