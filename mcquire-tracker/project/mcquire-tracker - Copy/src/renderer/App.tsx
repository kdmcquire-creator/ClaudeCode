import React, { useState, useEffect } from "react"
import Sidebar from "./components/Sidebar"
import Dashboard from "./screens/Dashboard"
import ReviewQueue from "./screens/ReviewQueue"
import Transactions from "./screens/Transactions"
import Reports from "./screens/Reports"
import Investments from "./screens/Investments"
import Settings from "./screens/Settings/index"
import SetupWizard from "./screens/SetupWizard"

export type Screen = "dashboard" | "review" | "transactions" | "reports" | "investments" | "settings"

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard")
  const [isFirstRun, setIsFirstRun] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [lockWarning, setLockWarning] = useState(false)

  useEffect(() => {
    // Try event-based init (if main process sends it)
    try {
      if (window.api?.onInit) {
        window.api.onInit(({ firstRun }) => {
          setIsFirstRun(firstRun)
          setIsReady(true)
        })
      }
    } catch {}

    try {
      if (window.api?.onLockWarning) {
        window.api.onLockWarning(() => setLockWarning(true))
      }
    } catch {}

    try {
      if (window.api?.onNewTransactions) {
        window.api.onNewTransactions(({ count }) => {
          if (count > 0) setPendingCount(p => p + count)
        })
      }
    } catch {}

    // Fallback: check sync folder to determine first run
    const checkReady = async () => {
      try {
        const folder = await window.electronAPI?.getSyncFolder?.()
        if (folder) {
          setIsFirstRun(false)
        }
      } catch {}
      setIsReady(true)
    }

    setTimeout(checkReady, 500)
  }, [])

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-white text-lg">Loading McQuire Tracker...</div>
      </div>
    )
  }

  if (isFirstRun) {
    return <SetupWizard onComplete={() => { setIsFirstRun(false) }} />
  }

  const screens: Record<Screen, React.ReactNode> = {
    dashboard: <Dashboard onNavigate={setScreen} />,
    review: <ReviewQueue onPendingChange={setPendingCount} />,
    transactions: <Transactions />,
    reports: <Reports />,
    investments: <Investments />,
    settings: <Settings />,
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {lockWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white text-sm px-4 py-2 flex items-center justify-between">
          <span>⚠️ This database may be in use on another machine. Changes here could conflict with unsaved work there.</span>
          <button onClick={() => setLockWarning(false)} className="ml-4 font-bold">✕</button>
        </div>
      )}
      <Sidebar activeScreen={screen} onNavigate={setScreen} pendingCount={pendingCount} />
      <main className="flex-1 overflow-auto">
        {screens[screen]}
      </main>
    </div>
  )
}

// Global type for the API
declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>
      getSyncFolder: () => Promise<string | null>
      setSyncFolder: (path: string) => Promise<void>
      initDatabase: (folder: string) => Promise<void>
    }
    api: {
      onInit?: (cb: (data: { firstRun: boolean; syncFolder: string; version: string }) => void) => void
      onLockWarning?: (cb: () => void) => void
      onNewTransactions?: (cb: (data: { account: string; count: number }) => void) => void
      onSetupComplete?: (cb: () => void) => void
      db: {
        getSetting: (key: string) => Promise<any>
        setSetting: (key: string, value: string) => Promise<any>
        getReviewCount: () => Promise<any>
        getBucketTotals: () => Promise<any>
      }
      transactions: {
        getPending: () => Promise<any>
        classify: (id: string, update: Record<string, any>) => Promise<any>
        getAll: (filters?: Record<string, any>) => Promise<any>
        split: (parentId: string, fragments: any[]) => Promise<any>
      }
      rules: {
        getAll: () => Promise<any>
        save: (rule: Record<string, any>) => Promise<any>
        delete: (id: string) => Promise<any>
      }
      trips: {
        getAll: () => Promise<any>
        save: (trip: any) => Promise<any>
        delete: (id: string) => Promise<any>
      }
      shell: {
        openPath: (filePath: string) => Promise<any>
      }
      reports: {
        generateExpenseReport: (payload: any) => Promise<any>
        checkExpenseReportReadiness: () => Promise<any>
      }
      plaid: any
      accounts: any
      syncLog: any
      investments: any
      statements: any
      import: any
      lifecycle: any
      email: {
        saveSmtp: (config: any) => Promise<any>
        sendTest: () => Promise<any>
      }
    }
  }
}
