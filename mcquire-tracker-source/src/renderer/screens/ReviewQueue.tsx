import { useEffect, useState, useCallback } from "react"
import { P10_CATEGORIES, LLC_CATEGORIES } from "../../shared/types"

function unwrap<T>(res: any, fallback: T): T {
  if (res === null || res === undefined) return fallback
  if (typeof res === "object" && "data" in res) return (res.data as T) ?? fallback
  return (res as T) ?? fallback
}

interface Props {
  onPendingChange?: (count: number) => void
}


const bucketColor: Record<string, string> = {
  "Peak 10": "bg-blue-100 text-blue-800",
  "Moonsmoke LLC": "bg-green-100 text-green-800",
  "Watersound Investments LLC": "bg-purple-100 text-purple-800",
  Personal: "bg-gray-100 text-gray-700",
  Exclude: "bg-red-100 text-red-700",
}

const statusColor: Record<string, string> = {
  pending_review: "border-l-orange-400",
  flagged: "border-l-red-500",
  ask_kyle: "border-l-orange-400",
  auto_classified: "border-l-green-400",
}

const fmt = (n: number) =>
  `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) => {
  if (!s) return ""
  const d = new Date(s + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function ReviewQueue({ onPendingChange }: Props) {
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [classifyState, setClassifyState] = useState<Record<string, any>>({})
  const [splitState, setSplitState] = useState<Record<string, { a1: string; a2: string; showSplit: boolean }>>({})
  const [attAmt, setAttAmt] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [filterStatus, setFilterStatus] = useState<"all" | "pending_review" | "flagged">("all")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const raw = await window.api.transactions.getPending().catch(() => [])
      const arr: any[] = unwrap<any[]>(raw, [])
      setTransactions(arr)
      onPendingChange?.(arr.length)
    } catch (e: any) {
      setError("Failed to load transactions: " + (e?.message ?? "unknown error"))
    } finally {
      setLoading(false)
    }
  }, [onPendingChange])

  useEffect(() => { load() }, [load])

  const visible = transactions.filter(t =>
    filterStatus === "all" ? true : t.review_status === filterStatus
  )

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const getCs = (id: string) => classifyState[id] ?? {}
  const setCs = (id: string, patch: any) =>
    setClassifyState(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))

  const getSplit = (id: string) => splitState[id] ?? { a1: "", a2: "", showSplit: false }
  const setSplit = (id: string, patch: any) =>
    setSplitState(prev => ({ ...prev, [id]: { ...(getSplit(id)), ...patch } }))

  const handleClassify = async (tx: any) => {
    const cs = getCs(tx.id)
    if (!cs.bucket) return
    setSaving(prev => ({ ...prev, [tx.id]: true }))
    try {
      const update: any = {
        bucket: cs.bucket,
        review_status: "manually_classified",
        description_notes: cs.notes ?? tx.description_notes ?? "",
      }
      if (cs.bucket === "Peak 10") update.p10_category = cs.category ?? ""
      if (cs.bucket === "Moonsmoke LLC") update.llc_category = cs.category ?? ""
      if (cs.bucket === "Exclude") update.bucket = "Exclude"
      await window.api.transactions.classify(tx.id, update)

      if (cs.createRule && cs.bucket !== "Exclude") {
        const rule: any = {
          rule_name: `${tx.merchant_name ?? tx.description_raw} — ${cs.bucket}`,
          section: cs.bucket === "Peak 10" ? "p10_always" : cs.bucket === "Moonsmoke LLC" ? "llc_always" : cs.bucket === "Watersound Investments LLC" ? "llc_always" : "personal_override",
          match_type: "contains",
          match_value: (tx.merchant_name ?? tx.description_raw ?? "").toLowerCase(),
          bucket: cs.bucket,
          p10_category: cs.bucket === "Peak 10" ? (cs.category ?? "") : null,
          llc_category: cs.bucket === "Moonsmoke LLC" ? (cs.category ?? "") : null,
          description_notes: cs.notes ?? "",
          action: "classify",
          priority_order: 850,
          is_active: 1,
        }
        const ruleResult = await window.api.rules.save(rule)
        if (ruleResult?.success === false) {
          console.error('Rule save failed:', ruleResult.error)
          alert('Warning: classification was saved but the rule could not be created: ' + (ruleResult.error ?? 'unknown error'))
        }
      }

      setTransactions(prev => prev.filter(t => t.id !== tx.id))
      onPendingChange?.(transactions.length - 1)
    } catch (e: any) {
      alert("Error classifying: " + (e?.message ?? "unknown"))
    } finally {
      setSaving(prev => ({ ...prev, [tx.id]: false }))
    }
  }

  const handleSplit = async (tx: any) => {
    const sp = getSplit(tx.id)
    const a1 = parseFloat(sp.a1)
    const a2 = parseFloat(sp.a2)
    if (isNaN(a1) || isNaN(a2)) { alert("Enter valid amounts for both fragments."); return }
    const cs = getCs(tx.id)
    setSaving(prev => ({ ...prev, [tx.id]: true }))
    try {
      await window.api.transactions.split(tx.id, [
        { amount: a1, bucket: cs.bucket ?? "Peak 10", p10_category: cs.category, llc_category: cs.llcCategory, description_notes: cs.notes ?? "" },
        { amount: a2, bucket: cs.splitBucket ?? "Personal", description_notes: cs.splitNotes ?? "" },
      ])
      setTransactions(prev => prev.filter(t => t.id !== tx.id))
    } catch (e: any) {
      alert("Split error: " + (e?.message ?? "unknown"))
    } finally {
      setSaving(prev => ({ ...prev, [tx.id]: false }))
    }
  }

  const isAttSplit = (tx: any) =>
    tx.flag_reason?.toLowerCase().includes('at&t') && Math.abs(tx.amount) >= 300

  const handleAttSplit = async (tx: any) => {
    const p10Amount = parseFloat(attAmt[tx.id] ?? "")
    if (isNaN(p10Amount) || p10Amount <= 0 || p10Amount >= Math.abs(tx.amount)) {
      alert("Enter a valid Peak 10 business line cost less than the total.")
      return
    }
    const personalAmount = Math.abs(tx.amount) - p10Amount
    setSaving(prev => ({ ...prev, [tx.id]: true }))
    try {
      await window.api.transactions.split(tx.id, [
        { amount: p10Amount,     bucket: "Peak 10",  p10_category: "Telephone & Communication", description_notes: "AT&T line 832-687-0468 — Peak 10" },
        { amount: personalAmount, bucket: "Personal", description_notes: "AT&T personal lines — remainder" },
      ])
      setTransactions(prev => prev.filter(t => t.id !== tx.id))
      onPendingChange?.(transactions.length - 1)
    } catch (e: any) {
      alert("Split error: " + (e?.message ?? "unknown"))
    } finally {
      setSaving(prev => ({ ...prev, [tx.id]: false }))
    }
  }

  const handleBatchClassify = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const bucket = prompt("Bucket for all selected (Peak 10 / Moonsmoke LLC / Personal / Watersound Investments LLC / Exclude):")
    if (!bucket) return
    for (const id of ids) {
      try {
        await window.api.transactions.classify(id, { bucket, review_status: "manually_classified" })
      } catch {}
    }
    setTransactions(prev => prev.filter(t => !selected.has(t.id)))
    setSelected(new Set())
    onPendingChange?.(transactions.length - ids.length)
  }

  if (loading) return <div className="p-8 text-gray-500">Loading review queue...</div>
  if (error) return <div className="p-8 text-red-600">{error} <button onClick={load} className="underline ml-2">Retry</button></div>

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Review Queue</h1>
          <p className="text-sm text-slate-500 mt-1">{visible.length} transaction{visible.length !== 1 ? "s" : ""} need your attention</p>
        </div>
        <div className="flex gap-3 items-center">
          {selected.size > 0 && (
            <button onClick={handleBatchClassify} className="px-3 py-2 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-800">
              Classify {selected.size} Selected
            </button>
          )}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as any)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All ({transactions.length})</option>
            <option value="pending_review">Pending ({transactions.filter(t => t.review_status === "pending_review").length})</option>
            <option value="flagged">Flagged ({transactions.filter(t => t.review_status === "flagged").length})</option>
          </select>
          <button onClick={load} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            Refresh
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-green-800 font-medium text-lg">Queue is clear</p>
          <p className="text-green-600 text-sm mt-1">All transactions have been classified.</p>
        </div>
      )}

      <div className="space-y-4">
        {visible.map(tx => {
          const cs = getCs(tx.id)
          const sp = getSplit(tx.id)
          const isExpanded = expandedId === tx.id
          const isSaving = saving[tx.id]
          const borderColor = statusColor[tx.review_status] ?? "border-l-gray-300"

          return (
            <div
              key={tx.id}
              className={`bg-white rounded-xl border border-slate-200 border-l-4 ${borderColor} shadow-sm`}
            >
              {/* Card Header */}
              <div
                className="p-4 cursor-pointer flex items-start gap-3"
                onClick={() => setExpandedId(isExpanded ? null : tx.id)}
              >
                <input
                  type="checkbox"
                  checked={selected.has(tx.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggleSelect(tx.id)}
                  className="mt-1 rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 truncate">
                      {tx.merchant_name || tx.description_raw || "Unknown"}
                    </span>
                    {tx.review_status === "flagged" && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">⚠️ Flagged</span>
                    )}
                    {tx.flag_reason && (
                      <span className="text-xs text-red-600 italic">{tx.flag_reason}</span>
                    )}
                    {tx.bucket && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bucketColor[tx.bucket] ?? "bg-gray-100 text-gray-600"}`}>
                        {tx.bucket}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5 flex gap-3 flex-wrap">
                    <span>{fmtDate(tx.transaction_date)}</span>
                    <span>{tx.account_mask ? `···${tx.account_mask}` : tx.account_id ?? ""}</span>
                    {tx.category_source && <span className="italic">{tx.category_source}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-bold text-lg ${tx.amount < 0 ? "text-green-600" : "text-slate-800"}`}>
                    {tx.amount < 0 ? "-" : ""}{fmt(tx.amount)}
                  </div>
                  {tx.amount < 0 && (
                    <div className="text-xs text-green-600 font-medium mt-0.5">Credit / Refund</div>
                  )}
                  <div className="text-xs text-slate-400 mt-0.5">{isExpanded ? "▲ collapse" : "▼ expand"}</div>
                </div>
              </div>

              {/* Expanded Classification Controls */}
              {isExpanded && (
                <div className="border-t border-slate-100 p-4 space-y-4">

                  {/* Flag banner */}
                  {tx.flag_reason && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                      <strong>⚠️ Action needed:</strong> {tx.flag_reason}
                    </div>
                  )}

                  {/* AT&T bill split tool — shown for AT&T flagged charges ≥ $300 */}
                  {isAttSplit(tx) && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-semibold text-orange-800">📱 AT&T Bill Split</p>
                      <p className="text-xs text-orange-700">
                        Enter the cost for Peak 10 business line <strong>832-687-0468</strong>.
                        The remainder will be classified as Personal.
                      </p>
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-orange-700 block mb-1">Peak 10 amount (line 832-687-0468)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={(Math.abs(tx.amount) - 0.01).toFixed(2)}
                            value={attAmt[tx.id] ?? ""}
                            onChange={e => {
                              setAttAmt(prev => ({ ...prev, [tx.id]: e.target.value }))
                            }}
                            placeholder="0.00"
                            className="w-full border border-orange-300 rounded px-2 py-1.5 text-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-orange-700 block mb-1">Personal remainder (auto)</label>
                          <div className="border border-orange-200 bg-orange-50 rounded px-2 py-1.5 text-sm text-orange-800 font-medium">
                            {attAmt[tx.id] && !isNaN(parseFloat(attAmt[tx.id]))
                              ? fmt(Math.abs(tx.amount) - parseFloat(attAmt[tx.id]))
                              : "—"}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleAttSplit(tx)}
                        disabled={isSaving || !attAmt[tx.id]}
                        className="w-full py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50"
                      >
                        {isSaving ? "Splitting…" : "Confirm AT&T Split"}
                      </button>
                    </div>
                  )}

                  {/* Bucket selector */}
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Classify As</label>
                    <div className="flex gap-2 flex-wrap">
                      {["Peak 10", "Moonsmoke LLC", "Personal", "Watersound Investments LLC", "Exclude"].map(b => (
                        <button
                          key={b}
                          onClick={() => setCs(tx.id, { bucket: b, category: "", llcCategory: "" })}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            cs.bucket === b
                              ? b === "Peak 10" ? "bg-blue-600 text-white"
                                : b === "Moonsmoke LLC" ? "bg-green-600 text-white"
                                : b === "Exclude" ? "bg-red-600 text-white"
                                : "bg-slate-600 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category selector */}
                  {cs.bucket === "Peak 10" && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">P10 Category</label>
                      <select
                        value={cs.category ?? ""}
                        onChange={e => setCs(tx.id, { category: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">— Select category —</option>
                        {P10_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )}

                  {cs.bucket === "Moonsmoke LLC" && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">LLC Schedule C Category</label>
                      <select
                        value={cs.category ?? ""}
                        onChange={e => setCs(tx.id, { category: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">— Select category —</option>
                        {LLC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Attendee / notes field */}
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
                      Description / Notes
                      {cs.bucket === "Peak 10" && cs.category === "Meals & Meetings - external" && (
                        <span className="text-orange-500 ml-2">⚠️ Attendee names required</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={cs.notes ?? tx.description_notes ?? ""}
                      onChange={e => setCs(tx.id, { notes: e.target.value })}
                      placeholder={cs.bucket === "Peak 10" && cs.category === "Meals & Meetings - external" ? "Names and titles of all attendees..." : "Optional notes..."}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  {/* Split tool */}
                  <div>
                    <button
                      onClick={() => setSplit(tx.id, { showSplit: !sp.showSplit })}
                      className="text-sm text-blue-600 underline"
                    >
                      {sp.showSplit ? "Hide split tool" : "Split transaction"}
                    </button>

                    {sp.showSplit && (
                      <div className="mt-3 bg-slate-50 rounded-lg p-4 space-y-3">
                        <p className="text-xs text-slate-500">Total: {fmt(tx.amount)}. Amounts must sum to total.</p>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Fragment 1 Amount</label>
                            <input type="number" step="0.01" value={sp.a1} onChange={e => setSplit(tx.id, { a1: e.target.value })}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="0.00" />
                            <label className="text-xs text-slate-500 block mt-2 mb-1">Bucket</label>
                            <select value={cs.bucket ?? ""} onChange={e => setCs(tx.id, { bucket: e.target.value })}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                              <option value="">Select...</option>
                              <option>Peak 10</option><option>Moonsmoke LLC</option><option>Personal</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Fragment 2 Amount</label>
                            <input type="number" step="0.01" value={sp.a2} onChange={e => setSplit(tx.id, { a2: e.target.value })}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="0.00" />
                            <label className="text-xs text-slate-500 block mt-2 mb-1">Bucket</label>
                            <select value={cs.splitBucket ?? "Personal"} onChange={e => setCs(tx.id, { splitBucket: e.target.value })}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                              <option>Peak 10</option><option>Moonsmoke LLC</option><option>Personal</option>
                            </select>
                          </div>
                        </div>
                        <button
                          onClick={() => handleSplit(tx)}
                          disabled={isSaving}
                          className="px-4 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 disabled:opacity-50"
                        >
                          {isSaving ? "Splitting..." : "Confirm Split"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Create rule toggle */}
                  {cs.bucket && cs.bucket !== "Exclude" && (
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cs.createRule ?? false}
                        onChange={e => setCs(tx.id, { createRule: e.target.checked })}
                        className="rounded"
                      />
                      Always classify "{tx.merchant_name || tx.description_raw}" as {cs.bucket}
                    </label>
                  )}

                  {/* Confirm button */}
                  {cs.bucket && !sp.showSplit && (
                    <button
                      onClick={() => handleClassify(tx)}
                      disabled={isSaving}
                      className="w-full py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
                    >
                      {isSaving ? "Saving..." : `Confirm → ${cs.bucket}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
