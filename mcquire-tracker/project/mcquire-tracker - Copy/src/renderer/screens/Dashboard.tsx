import React, { useEffect, useState } from "react"
import type { Screen } from "../App"

interface BucketData {
  peak10: { count: number; total: number }
  llc: { count: number; total: number }
  personal: { income: number; expenses: number; count: number }
  pending_review: number
  flagged: number
}

const fmt = (n: number) =>
  `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface Props {
  onNavigate: (s: Screen) => void
}

export default function Dashboard({ onNavigate }: Props) {
  const [buckets, setBuckets] = useState<BucketData | null>(null)
  const [accounts, setAccounts] = useState<any[]>([])
  const [recentTx, setRecentTx] = useState<any[]>([])
  const [investmentTotal, setInvestmentTotal] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = async () => {
    try {
      // Bucket totals
      const totals = await window.api.db.getBucketTotals().catch(() => null)

      if (totals) {
        setBuckets(totals)
      } else {
        // Build from transactions if getBucketTotals isn't wired
        const allTx = await window.api.transactions.getAll().catch(() => [])
        const p10 = allTx.filter((t: any) => t.bucket === "Peak 10")
        const llc = allTx.filter((t: any) => t.bucket === "Moonsmoke LLC")
        const personal = allTx.filter((t: any) => t.bucket === "Personal")
        const pending = allTx.filter((t: any) => t.review_status === "pending_review")
        const flagged = allTx.filter((t: any) => t.review_status === "flagged")

        setBuckets({
          peak10: { count: p10.length, total: p10.reduce((s: number, t: any) => s + (t.amount || 0), 0) },
          llc: { count: llc.length, total: llc.reduce((s: number, t: any) => s + (t.amount || 0), 0) },
          personal: {
            count: personal.length,
            expenses: personal.filter((t: any) => t.amount > 0).reduce((s: number, t: any) => s + t.amount, 0),
            income: personal.filter((t: any) => t.amount < 0).reduce((s: number, t: any) => s + Math.abs(t.amount), 0),
          },
          pending_review: pending.length,
          flagged: flagged.length,
        })
      }

      // Review count
      const rc = await window.api.db.getReviewCount().catch(() => 0)
      setReviewCount(typeof rc === "number" ? rc : rc?.count ?? 0)

      // Accounts — correct method is list()
      const accts = await window.api.accounts.list().catch(() => [])
      setAccounts(Array.isArray(accts) ? accts : [])

      // Recent transactions
      const recent = await window.api.transactions.getAll({ limit: 8 }).catch(() => [])
      setRecentTx(Array.isArray(recent) ? recent.slice(0, 8) : [])

      // Investment total — correct method is getPortfolioSummary()
      const inv = await window.api.investments.getPortfolioSummary().catch(() => null)
      setInvestmentTotal(inv?.total_value ?? inv?.totalValue ?? 0)

    } catch (err) {
      console.error("Dashboard load error:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await window.api.plaid?.syncAll?.()
    } catch {}
    await load()
    setSyncing(false)
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>

  const b = {
    peak10: { count: buckets?.peak10?.count ?? 0, total: buckets?.peak10?.total ?? 0 },
    llc: { count: buckets?.llc?.count ?? 0, total: buckets?.llc?.total ?? 0 },
    personal: { income: buckets?.personal?.income ?? 0, expenses: buckets?.personal?.expenses ?? 0, count: buckets?.personal?.count ?? 0 },
    pending_review: buckets?.pending_review ?? 0,
    flagged: buckets?.flagged ?? 0,
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="btn btn-primary flex items-center gap-2"
        >
          {syncing ? "Syncing..." : "🔄 Sync Now"}
        </button>
      </div>

      {/* Bucket cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card border-l-4 border-brand-blue">
          <div className="text-xs font-semibold text-brand-blue uppercase mb-1">🏢 Peak 10 (W2)</div>
          <div className="text-2xl font-bold text-gray-900">{fmt(b.peak10.total)}</div>
          <div className="text-sm text-gray-500 mt-1">{b.peak10.count} transactions</div>
          <div className="text-xs text-gray-400 mt-1">Expense reimbursement pending</div>
        </div>
        <div className="card border-l-4 border-green-600">
          <div className="text-xs font-semibold text-green-700 uppercase mb-1">💼 Moonsmoke LLC</div>
          <div className="text-2xl font-bold text-gray-900">{fmt(b.llc.total)}</div>
          <div className="text-sm text-gray-500 mt-1">{b.llc.count} transactions</div>
          <div className="text-xs text-gray-400 mt-1">Schedule C</div>
        </div>
        <div className="card border-l-4 border-gray-400">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">🏠 Personal</div>
          <div className="text-lg font-bold text-gray-900">
            {fmt(b.personal.expenses)} <span className="text-sm font-normal text-gray-500">expenses</span>
          </div>
          <div className="text-sm text-gray-500">{fmt(b.personal.income)} income</div>
          <div className="text-xs text-gray-400 mt-1">{b.personal.count} transactions</div>
        </div>
      </div>

      {/* Review queue and investments row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div
          className="card cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onNavigate("review")}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-orange-600 uppercase">Needs Review</div>
              <div className="text-3xl font-bold text-orange-600 mt-1">{b.pending_review}</div>
            </div>
            <div className="text-4xl">📋</div>
          </div>
          {b.flagged > 0 && (
            <div className="text-xs text-red-600 mt-2">+ {b.flagged} flagged items</div>
          )}
        </div>
        <div
          className="card cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onNavigate("investments")}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-indigo-600 uppercase">Portfolio Value</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(investmentTotal)}</div>
            </div>
            <div className="text-4xl">📈</div>
          </div>
          <div className="text-xs text-gray-400 mt-2">Fidelity · Schwab · Chase</div>
        </div>
        <div className="card">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Accounts</div>
          {accounts.length === 0 ? (
            <div className="text-sm text-gray-400 italic">No accounts connected</div>
          ) : (
            accounts.slice(0, 4).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-gray-700">
                  {a.institution} ···{a.account_mask}
                </span>
                <span className={`badge ${a.is_active ? "badge-classified" : "badge-personal"}`}>
                  {a.last_synced_at
                    ? new Date(a.last_synced_at).toLocaleDateString()
                    : "Never synced"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Recent activity */}
        <div className="card col-span-2">
          <div className="font-semibold text-gray-700 mb-3">Recent Activity</div>
          {recentTx.length === 0 ? (
            <div className="text-sm text-gray-400 italic">
              No transactions yet. Connect accounts or import CSV files to get started.
            </div>
          ) : (
            <div className="space-y-1">
              {recentTx.map((tx: any) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between text-sm py-0.5 border-b border-gray-50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-400 text-xs flex-shrink-0">
                      {tx.transaction_date}
                    </span>
                    <span className="text-gray-700 truncate">
                      {tx.merchant_name ?? tx.description_raw}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span
                      className={`badge ${
                        tx.bucket === "Peak 10"
                          ? "badge-p10"
                          : tx.bucket === "Moonsmoke LLC"
                          ? "badge-llc"
                          : "badge-personal"
                      }`}
                    >
                      {tx.bucket || "Unclassified"}
                    </span>
                    <span className="text-gray-700 font-medium">{fmt(tx.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
