import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:3001";

// ══════════════════════════════════════════════════════════════
// THEME & STYLING
// ══════════════════════════════════════════════════════════════

const theme = {
  bg: "#0F1117",
  surface: "#1A1D27",
  surfaceHover: "#22252F",
  border: "#2A2D3A",
  text: "#E4E4E7",
  textMuted: "#71717A",
  textDim: "#52525B",
  accent: "#3B82F6",
  critical: "#EF4444",
  criticalBg: "#1C1012",
  important: "#F97316",
  importantBg: "#1C1508",
  standard: "#EAB308",
  standardBg: "#1A1808",
  low: "#6B7280",
  success: "#22C55E",
  white: "#FFFFFF",
};

const styles = {
  app: {
    minHeight: "100vh",
    backgroundColor: theme.bg,
    color: theme.text,
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 24px",
    borderBottom: `1px solid ${theme.border}`,
    backgroundColor: theme.surface,
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  navBrand: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  navLogo: {
    fontSize: "18px",
    fontWeight: 700,
    color: theme.white,
    letterSpacing: "-0.02em",
  },
  navSub: {
    fontSize: "12px",
    color: theme.textMuted,
    fontWeight: 400,
  },
  navTabs: {
    display: "flex",
    gap: "4px",
    backgroundColor: theme.bg,
    borderRadius: "8px",
    padding: "3px",
  },
  navTab: (active) => ({
    padding: "8px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    border: "none",
    color: active ? theme.white : theme.textMuted,
    backgroundColor: active ? theme.accent : "transparent",
    transition: "all 0.15s ease",
  }),
  main: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "24px",
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: "12px",
    border: `1px solid ${theme.border}`,
    overflow: "hidden",
    marginBottom: "16px",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: `1px solid ${theme.border}`,
  },
  cardTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: theme.text,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  badge: (color) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "22px",
    height: "22px",
    borderRadius: "11px",
    fontSize: "12px",
    fontWeight: 600,
    padding: "0 6px",
    color: theme.white,
    backgroundColor: color,
  }),
  emailRow: (tier) => ({
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "14px 20px",
    borderBottom: `1px solid ${theme.border}`,
    cursor: "pointer",
    backgroundColor: "transparent",
    transition: "background-color 0.1s ease",
    borderLeft: `3px solid ${tier === 'critical' ? theme.critical : tier === 'important' ? theme.important : tier === 'standard' ? theme.standard : 'transparent'}`,
  }),
  emailSender: {
    fontSize: "13px",
    fontWeight: 600,
    color: theme.text,
    marginBottom: "2px",
  },
  emailSubject: {
    fontSize: "13px",
    color: theme.textMuted,
    marginBottom: "4px",
    lineHeight: 1.4,
  },
  emailMeta: {
    fontSize: "11px",
    color: theme.textDim,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "12px",
    marginBottom: "24px",
  },
  statCard: (color) => ({
    backgroundColor: theme.surface,
    borderRadius: "12px",
    border: `1px solid ${theme.border}`,
    padding: "20px",
    borderTop: `3px solid ${color}`,
  }),
  statNumber: {
    fontSize: "32px",
    fontWeight: 700,
    lineHeight: 1,
    marginBottom: "4px",
  },
  statLabel: {
    fontSize: "12px",
    color: theme.textMuted,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  btn: (variant = "default") => ({
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    border: "none",
    color: variant === "primary" ? theme.white : theme.textMuted,
    backgroundColor: variant === "primary" ? theme.accent : theme.bg,
    transition: "all 0.15s ease",
  }),
  draftCard: {
    backgroundColor: theme.bg,
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "12px",
    border: `1px solid ${theme.border}`,
  },
  draftLabel: {
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "8px",
  },
  draftBody: {
    fontSize: "13px",
    lineHeight: 1.6,
    color: theme.textMuted,
    whiteSpace: "pre-wrap",
  },
  calSuggestion: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "14px 20px",
    borderBottom: `1px solid ${theme.border}`,
  },
  calDot: (urgency) => ({
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    marginTop: "6px",
    flexShrink: 0,
    backgroundColor: urgency === 'high' ? theme.critical : urgency === 'medium' ? theme.important : theme.accent,
  }),
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px",
    color: theme.textMuted,
    fontSize: "14px",
  },
  emptyState: {
    textAlign: "center",
    padding: "40px 20px",
    color: theme.textDim,
    fontSize: "13px",
  },
  settingsSection: {
    padding: "20px",
    borderBottom: `1px solid ${theme.border}`,
  },
  settingsLabel: {
    fontSize: "13px",
    fontWeight: 600,
    marginBottom: "8px",
    color: theme.text,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "6px",
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "6px",
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: "13px",
    outline: "none",
    minHeight: "100px",
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
};

// ══════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ══════════════════════════════════════════════════════════════

function TimeAgo({ date }) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  
  let text;
  if (mins < 60) text = `${mins}m ago`;
  else if (hrs < 24) text = `${hrs}h ago`;
  else if (days === 1) text = "Yesterday";
  else text = `${days}d ago`;
  
  return <span>{text}</span>;
}

function Badge({ count, color }) {
  if (!count) return null;
  return <span style={styles.badge(color)}>{count}</span>;
}

function EmptyState({ message }) {
  return <div style={styles.emptyState}>{message}</div>;
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ══════════════════════════════════════════════════════════════

function Dashboard({ data, loading, onSelectEmail }) {
  if (loading) return <div style={styles.loading}>Loading dashboard...</div>;
  if (!data) return <div style={styles.loading}>No data available</div>;

  const { inbound, outbound } = data;

  return (
    <div>
      {/* Stats Row */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard(theme.critical)}>
          <div style={{ ...styles.statNumber, color: theme.critical }}>{inbound.counts.critical}</div>
          <div style={styles.statLabel}>Critical</div>
        </div>
        <div style={styles.statCard(theme.important)}>
          <div style={{ ...styles.statNumber, color: theme.important }}>{inbound.counts.important}</div>
          <div style={styles.statLabel}>Important</div>
        </div>
        <div style={styles.statCard(theme.standard)}>
          <div style={{ ...styles.statNumber, color: theme.standard }}>{inbound.counts.standard}</div>
          <div style={styles.statLabel}>Standard</div>
        </div>
        <div style={styles.statCard(theme.accent)}>
          <div style={{ ...styles.statNumber, color: theme.accent }}>{outbound.count}</div>
          <div style={styles.statLabel}>Awaiting Reply</div>
        </div>
      </div>

      {/* Critical Items */}
      {inbound.critical.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardTitle}>
              <span style={{ color: theme.critical }}>●</span>
              Critical — Needs Your Response
              <Badge count={inbound.critical.length} color={theme.critical} />
            </div>
          </div>
          {inbound.critical.map((email) => (
            <div
              key={email.id}
              style={styles.emailRow("critical")}
              onClick={() => onSelectEmail(email.id)}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.surfaceHover}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
            >
              <div style={{ flex: 1 }}>
                <div style={styles.emailSender}>{email.sender?.name || email.sender?.address}</div>
                <div style={styles.emailSubject}>{email.subject}</div>
                <div style={styles.emailMeta}>
                  <TimeAgo date={email.receivedDate} /> · {email.signals?.join(", ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Important Items */}
      {inbound.important.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardTitle}>
              <span style={{ color: theme.important }}>●</span>
              Important
              <Badge count={inbound.important.length} color={theme.important} />
            </div>
          </div>
          {inbound.important.slice(0, 10).map((email) => (
            <div
              key={email.id}
              style={styles.emailRow("important")}
              onClick={() => onSelectEmail(email.id)}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.surfaceHover}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
            >
              <div style={{ flex: 1 }}>
                <div style={styles.emailSender}>{email.sender?.name || email.sender?.address}</div>
                <div style={styles.emailSubject}>{email.subject}</div>
                <div style={styles.emailMeta}><TimeAgo date={email.receivedDate} /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Standard Items */}
      {inbound.standard.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardTitle}>
              <span style={{ color: theme.standard }}>●</span>
              Standard
              <Badge count={inbound.standard.length} color={theme.standard} />
            </div>
          </div>
          {inbound.standard.slice(0, 8).map((email) => (
            <div
              key={email.id}
              style={styles.emailRow("standard")}
              onClick={() => onSelectEmail(email.id)}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.surfaceHover}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
            >
              <div style={{ flex: 1 }}>
                <div style={styles.emailSender}>{email.sender?.name || email.sender?.address}</div>
                <div style={styles.emailSubject}>{email.subject}</div>
                <div style={styles.emailMeta}><TimeAgo date={email.receivedDate} /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Outbound Awaiting Reply */}
      {outbound.items.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardTitle}>
              <span style={{ color: theme.accent }}>↗</span>
              Sent — Awaiting Reply
              <Badge count={outbound.count} color={theme.accent} />
            </div>
          </div>
          {outbound.items.map((email) => (
            <div key={email.id} style={styles.emailRow("low")}>
              <div style={{ flex: 1 }}>
                <div style={styles.emailSender}>
                  To: {email.recipients?.map(r => r.name || r.address).join(", ")}
                </div>
                <div style={styles.emailSubject}>{email.subject}</div>
                <div style={styles.emailMeta}>
                  Sent <TimeAgo date={email.sentDate} /> · {email.daysSinceSent} day{email.daysSinceSent !== 1 ? 's' : ''} without reply
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All empty */}
      {inbound.counts.critical === 0 && inbound.counts.important === 0 && 
       inbound.counts.standard === 0 && outbound.count === 0 && (
        <EmptyState message="All clear. No items need your attention right now." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// EMAIL DETAIL VIEW
// ══════════════════════════════════════════════════════════════

function EmailDetail({ emailId, onBack }) {
  const [email, setEmail] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  useEffect(() => {
    if (!emailId) return;
    setLoading(true);
    fetch(`${API}/api/email/${emailId}`)
      .then(r => r.json())
      .then(data => { setEmail(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [emailId]);

  const generateDrafts = async () => {
    setDrafting(true);
    try {
      const res = await fetch(`${API}/api/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId }),
      });
      const data = await res.json();
      setDrafts(data.drafts);
    } catch (err) {
      console.error("Draft error:", err);
    }
    setDrafting(false);
  };

  const handleAction = async (action, extra = {}) => {
    try {
      await fetch(`${API}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, emailId, ...extra }),
      });
      setActionMsg(`${action} applied`);
      setTimeout(() => setActionMsg(""), 2000);
    } catch (err) {
      setActionMsg("Error: " + err.message);
    }
  };

  const sendDraft = async (body) => {
    try {
      await fetch(`${API}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId, body }),
      });
      setActionMsg("Reply sent");
      setTimeout(() => { setActionMsg(""); onBack(); }, 1500);
    } catch (err) {
      setActionMsg("Send failed: " + err.message);
    }
  };

  if (loading) return <div style={styles.loading}>Loading email...</div>;
  if (!email) return <div style={styles.loading}>Email not found</div>;

  const msg = email.message;

  return (
    <div>
      {/* Back button + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <button style={styles.btn()} onClick={onBack}>← Back</button>
        <button style={styles.btn()} onClick={() => handleAction("dismiss")}>Dismiss</button>
        <button style={styles.btn()} onClick={() => handleAction("mute-thread", { conversationId: msg.conversationId })}>Mute Thread</button>
        <button style={styles.btn()} onClick={() => handleAction("mute-sender", { senderAddress: msg.sender?.emailAddress?.address })}>Mute Sender</button>
        {actionMsg && <span style={{ fontSize: "12px", color: theme.success, marginLeft: "8px" }}>{actionMsg}</span>}
      </div>

      {/* Email header */}
      <div style={styles.card}>
        <div style={{ padding: "20px" }}>
          <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>{msg.subject}</div>
          <div style={{ fontSize: "13px", color: theme.textMuted, marginBottom: "4px" }}>
            From: {msg.sender?.emailAddress?.name} ({msg.sender?.emailAddress?.address})
          </div>
          <div style={{ fontSize: "13px", color: theme.textMuted, marginBottom: "12px" }}>
            {new Date(msg.receivedDateTime).toLocaleString()}
          </div>
          <div style={{ fontSize: "13px", lineHeight: 1.7, color: theme.text, whiteSpace: "pre-wrap" }}>
            {msg.bodyPreview || msg.body?.content?.replace(/<[^>]*>/g, '').substring(0, 1000)}
          </div>
        </div>
      </div>

      {/* Thread */}
      {email.thread && email.thread.length > 1 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardTitle}>Thread ({email.thread.length} messages)</div>
          </div>
          {email.thread.map((m, i) => (
            <div key={m.id || i} style={{ padding: "12px 20px", borderBottom: `1px solid ${theme.border}`, opacity: m.id === emailId ? 1 : 0.7 }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: theme.textMuted }}>
                {m.sender?.emailAddress?.name} · {new Date(m.receivedDateTime).toLocaleString()}
              </div>
              <div style={{ fontSize: "13px", color: theme.text, marginTop: "4px" }}>
                {m.bodyPreview || m.body?.content?.replace(/<[^>]*>/g, '').substring(0, 200)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Drafts */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardTitle}>AI Response Drafts</div>
          <button
            style={styles.btn("primary")}
            onClick={generateDrafts}
            disabled={drafting}
          >
            {drafting ? "Generating..." : drafts ? "Regenerate" : "Generate Drafts"}
          </button>
        </div>

        {drafts && !drafts.parseError ? (
          <div style={{ padding: "16px 20px" }}>
            {drafts.analysis && (
              <div style={{ ...styles.draftCard, borderColor: theme.accent }}>
                <div style={{ ...styles.draftLabel, color: theme.accent }}>Analysis</div>
                <div style={styles.draftBody}>
                  {drafts.analysis.summary} · Urgency: {drafts.analysis.urgency} · {drafts.analysis.senderRelationship}
                </div>
              </div>
            )}

            {/* Quick Acknowledge */}
            {drafts.quickAcknowledge && (
              <div style={styles.draftCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...styles.draftLabel, color: theme.success }}>Quick Acknowledge</div>
                  <button style={styles.btn("primary")} onClick={() => sendDraft(drafts.quickAcknowledge.body)}>Send This</button>
                </div>
                <div style={styles.draftBody}>{drafts.quickAcknowledge.body}</div>
              </div>
            )}

            {/* Substantive Reply */}
            {drafts.substantiveReply && (
              <div style={styles.draftCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...styles.draftLabel, color: theme.important }}>Substantive Reply</div>
                  <button style={styles.btn("primary")} onClick={() => sendDraft(drafts.substantiveReply.body)}>Send This</button>
                </div>
                <div style={styles.draftBody}>{drafts.substantiveReply.body}</div>
              </div>
            )}

            {/* Delegate */}
            {drafts.delegateRedirect && (
              <div style={styles.draftCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...styles.draftLabel, color: theme.textMuted }}>Delegate / Redirect</div>
                  <button style={styles.btn("primary")} onClick={() => sendDraft(drafts.delegateRedirect.body)}>Send This</button>
                </div>
                <div style={styles.draftBody}>{drafts.delegateRedirect.body}</div>
                {drafts.delegateRedirect.suggestedDelegate && (
                  <div style={{ fontSize: "11px", color: theme.textDim, marginTop: "8px" }}>
                    Suggested delegate: {drafts.delegateRedirect.suggestedDelegate}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : drafts?.parseError ? (
          <div style={{ padding: "16px 20px" }}>
            <div style={styles.draftCard}>
              <div style={styles.draftBody}>{drafts.raw}</div>
            </div>
          </div>
        ) : (
          <EmptyState message="Click 'Generate Drafts' to get AI-written response options" />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// CALENDAR VIEW
// ══════════════════════════════════════════════════════════════

function CalendarView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionFeedback, setActionFeedback] = useState('');
  // Track acted-on suggestions by contactEmail so they vanish immediately
  const [actedOn, setActedOn] = useState(new Set());

  useEffect(() => {
    fetch(`${API}/api/calendar/suggestions`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSuggestionAction = async (action, suggestion) => {
    try {
      const res = await fetch(`${API}/api/calendar/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, suggestion }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed');

      setActedOn(prev => new Set([...prev, suggestion.contactEmail]));
      setActionFeedback(
        action === 'schedule' ? 'Meeting scheduled — check your calendar' :
        action === 'dismiss'  ? 'Dismissed'                               :
                                'Snoozed for 1 week'
      );
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
    }
    setTimeout(() => setActionFeedback(''), 3000);
  };

  const visibleSuggestions = (data?.suggestions || []).filter(
    s => !actedOn.has(s.contactEmail)
  );

  if (loading) return <div style={styles.loading}>Analyzing calendar and email patterns...</div>;

  return (
    <div>
      {/* Suggestions */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardTitle}>Meeting Suggestions</div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {actionFeedback && (
              <span style={{ fontSize: "12px", color: theme.success }}>{actionFeedback}</span>
            )}
            <span style={{ fontSize: "12px", color: theme.textMuted }}>
              Based on email patterns and relationship cadence
            </span>
          </div>
        </div>
        {visibleSuggestions.length > 0 ? (
          visibleSuggestions.map((s, i) => (
            <div key={i} style={styles.calSuggestion}>
              <div style={styles.calDot(s.urgency)} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: theme.text, marginBottom: "4px" }}>
                  {s.contactName}
                  <span style={{ fontSize: "11px", fontWeight: 400, color: theme.textDim, marginLeft: "8px" }}>
                    {s.type === 'cadence' ? 'Cadence' : 'Opportunity'}
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: theme.textMuted, lineHeight: 1.5, marginBottom: "6px" }}>
                  {s.reason}
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: theme.textDim }}>
                    {s.suggestedDuration}min · {s.suggestedTimeframe}
                  </span>
                  <button
                    style={styles.btn("primary")}
                    onClick={() => handleSuggestionAction('schedule', s)}
                  >
                    Schedule
                  </button>
                  <button
                    style={styles.btn()}
                    onClick={() => handleSuggestionAction('dismiss', s)}
                  >
                    Dismiss
                  </button>
                  <button
                    style={styles.btn()}
                    onClick={() => handleSuggestionAction('snooze', s)}
                  >
                    Snooze 1 wk
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="No meeting suggestions right now. Check back when more email data is available." />
        )}
      </div>

      {/* Existing Events */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardTitle}>Upcoming Events (Next 14 Days)</div>
        </div>
        {data?.existingEvents?.length > 0 ? (
          data.existingEvents.map((e, i) => (
            <div key={i} style={{ padding: "10px 20px", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: theme.text }}>{e.subject}</div>
              <div style={{ fontSize: "11px", color: theme.textMuted }}>
                {new Date(e.start?.dateTime).toLocaleString()} — {e.attendees?.length || 0} attendees
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="No upcoming events found." />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SETTINGS VIEW
// ══════════════════════════════════════════════════════════════

function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.json())
      .then(d => { setSettings(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const saveSettings = async () => {
    await fetch(`${API}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div style={styles.loading}>Loading settings...</div>;

  return (
    <div>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardTitle}>VIP Senders</div>
        </div>
        <div style={styles.settingsSection}>
          <div style={styles.settingsLabel}>Email addresses or domains that trigger Critical priority (one per line)</div>
          <textarea
            style={styles.textarea}
            value={settings?.vipSenders?.join("\n") || ""}
            onChange={(e) => setSettings({ ...settings, vipSenders: e.target.value.split("\n").filter(Boolean) })}
            placeholder="investor@example.com&#10;attorney@lawfirm.com&#10;boardmember@example.com"
          />
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardTitle}>Relationship Cadence Targets</div>
        </div>
        {settings?.cadenceTargets && Object.entries(settings.cadenceTargets).map(([key, val]) => (
          <div key={key} style={styles.settingsSection}>
            <div style={styles.settingsLabel}>{val.label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", color: theme.textMuted }}>Contact every</span>
              <input
                style={{ ...styles.input, width: "80px" }}
                type="number"
                value={val.days}
                onChange={(e) => setSettings({
                  ...settings,
                  cadenceTargets: {
                    ...settings.cadenceTargets,
                    [key]: { ...val, days: parseInt(e.target.value) || 0 }
                  }
                })}
              />
              <span style={{ fontSize: "13px", color: theme.textMuted }}>days</span>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardTitle}>Dead Deal Threshold</div>
        </div>
        <div style={styles.settingsSection}>
          <div style={styles.settingsLabel}>Days of inactivity before flagging a deal as potentially dead</div>
          <input
            style={{ ...styles.input, width: "120px" }}
            type="number"
            value={settings?.deadDealInactivityDays || 60}
            onChange={(e) => setSettings({ ...settings, deadDealInactivityDays: parseInt(e.target.value) || 60 })}
          />
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={styles.cardTitle}>Morning Digest</div>
        </div>
        <div style={styles.settingsSection}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <label style={{ fontSize: "13px", color: theme.textMuted, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings?.digestEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, digestEnabled: e.target.checked })}
              />
              Enable daily email digest
            </label>
            <input
              style={{ ...styles.input, width: "100px" }}
              type="time"
              value={settings?.digestTime || "07:30"}
              onChange={(e) => setSettings({ ...settings, digestTime: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
        <button style={styles.btn("primary")} onClick={saveSettings}>Save Settings</button>
        {saved && <span style={{ fontSize: "13px", color: theme.success, alignSelf: "center" }}>Settings saved</span>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════

export default function App() {
  const [view, setView] = useState("dashboard");
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/dashboard`)
      .then(r => r.json())
      .then(d => { setDashboardData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleSelectEmail = (id) => {
    setSelectedEmail(id);
    setView("email");
  };

  const handleBack = () => {
    setSelectedEmail(null);
    setView("dashboard");
    fetchDashboard();
  };

  const counts = dashboardData?.inbound?.counts || {};
  const totalBadge = (counts.critical || 0) + (counts.important || 0);

  return (
    <div style={styles.app}>
      {/* Navigation */}
      <nav style={styles.nav}>
        <div style={styles.navBrand}>
          <div>
            <div style={styles.navLogo}>PEAK 10<span style={{ color: theme.accent, marginLeft: "6px", fontWeight: 400 }}>Intelligence</span></div>
            <div style={styles.navSub}>Email & Calendar Management</div>
          </div>
        </div>

        <div style={styles.navTabs}>
          <button
            style={styles.navTab(view === "dashboard" || view === "email")}
            onClick={() => { setView("dashboard"); setSelectedEmail(null); }}
          >
            Dashboard {totalBadge > 0 && <Badge count={totalBadge} color={theme.critical} />}
          </button>
          <button
            style={styles.navTab(view === "calendar")}
            onClick={() => setView("calendar")}
          >
            Calendar
          </button>
          <button
            style={styles.navTab(view === "settings")}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button style={styles.btn()} onClick={fetchDashboard}>↻ Refresh</button>
          {dashboardData?.lastUpdated && (
            <span style={{ fontSize: "11px", color: theme.textDim }}>
              Updated: {new Date(dashboardData.lastUpdated).toLocaleTimeString()}
            </span>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main style={styles.main}>
        {view === "dashboard" && (
          <Dashboard data={dashboardData} loading={loading} onSelectEmail={handleSelectEmail} />
        )}
        {view === "email" && selectedEmail && (
          <EmailDetail emailId={selectedEmail} onBack={handleBack} />
        )}
        {view === "calendar" && <CalendarView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
