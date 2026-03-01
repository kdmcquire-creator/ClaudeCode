/**
 * Peak 10 Energy — Email Intelligence Server
 *
 * Backend API server that connects to Microsoft Graph API for email/calendar
 * data and Anthropic Claude API for response drafting and signal detection.
 *
 * Endpoints:
 *   GET  /api/dashboard              — Aggregated dashboard data (all tiers)
 *   GET  /api/inbound                — Inbound emails needing response
 *   GET  /api/outbound               — Sent emails awaiting reply
 *   GET  /api/email/:id              — Full email thread detail
 *   POST /api/draft                  — Generate AI response drafts
 *   POST /api/send                   — Send a response via Graph API
 *   POST /api/action                 — File, mute, snooze, dismiss an item
 *   GET  /api/calendar/suggestions   — AI-generated meeting suggestions
 *   POST /api/calendar/action        — Schedule, dismiss, or snooze a suggestion
 *   GET  /api/settings               — User settings
 *   PUT  /api/settings               — Update settings (persisted to disk)
 *   GET  /api/digest                 — Morning digest summary
 *   GET  /api/health                 — Health check
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const app = express();
app.use(cors());
app.use(express.json());

// ══════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════

const config = {
  // Azure AD / Microsoft Entra ID
  azureTenantId:    process.env.AZURE_TENANT_ID    || '',
  azureClientId:    process.env.AZURE_CLIENT_ID    || '',
  azureClientSecret:process.env.AZURE_CLIENT_SECRET || '',
  azureRedirectUri: process.env.AZURE_REDIRECT_URI  || 'http://localhost:3001/auth/callback',

  // Anthropic Claude API — always default to the latest capable model
  claudeApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel:  process.env.CLAUDE_MODEL      || 'claude-sonnet-4-6',

  // App
  port:      process.env.PORT       || 3001,
  userEmail: process.env.USER_EMAIL || '',

  // Graph API
  graphBaseUrl: 'https://graph.microsoft.com/v1.0',
};

// ══════════════════════════════════════════════════════════════
// MSAL / GRAPH AUTH
// ══════════════════════════════════════════════════════════════

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId:     config.azureClientId,
    authority:    `https://login.microsoftonline.com/${config.azureTenantId}`,
    clientSecret: config.azureClientSecret,
  },
});

let cachedToken = null;

async function getGraphToken() {
  if (cachedToken && cachedToken.expiresOn > new Date()) {
    return cachedToken.accessToken;
  }
  const result = await msalClient.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  cachedToken = result;
  return result.accessToken;
}

async function graphRequest(endpoint, method = 'GET', body = null) {
  const token = await getGraphToken();
  const url   = `${config.graphBaseUrl}${endpoint}`;

  const options = {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Graph API error (${response.status}): ${error}`);
  }
  return response.json();
}

// ══════════════════════════════════════════════════════════════
// CLAUDE API
// ══════════════════════════════════════════════════════════════

async function claudeRequest(systemPrompt, userMessage, maxTokens = 1500) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       config.claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      config.claudeModel,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ══════════════════════════════════════════════════════════════
// SETTINGS — file-persisted so state survives server restarts
// ══════════════════════════════════════════════════════════════

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const defaultSettings = {
  vipSenders:          [],
  mutedThreads:        [],
  mutedSenders:        [],
  dismissedSuggestions: [],   // contactEmail strings
  snoozedSuggestions:  [],    // [{ contactEmail, until }]
  cadenceTargets: {
    investors:          { days: 21, label: 'Investors / Board' },
    dealCounterparties: { days: 7,  label: 'Active Deal Counterparties' },
    jvPartners:         { days: 30, label: 'JV Partners' },
    serviceProviders:   { days: 90, label: 'Key Service Providers' },
    prospects:          { days: 14, label: 'Prospective Contacts' },
  },
  reminderTiming: {
    critical:  { initial: 4,  repeat: 24 },
    important: { initial: 24, repeat: 48 },
    standard:  { initial: 48, repeat: 0  },
  },
  deadDealInactivityDays: 60,
  digestTime:             '07:30',
  digestEnabled:          true,
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...defaultSettings, ...saved };
    }
  } catch (e) {
    console.warn('Could not load settings file:', e.message);
  }
  return { ...defaultSettings };
}

function persistSettings(s) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not persist settings:', e.message);
  }
}

let settings = loadSettings();

// ══════════════════════════════════════════════════════════════
// EMAIL ANALYSIS ENGINE
// ══════════════════════════════════════════════════════════════

function analyzeResponseNeed(email, isVip) {
  const subject = (email.subject     || '').toLowerCase();
  const body    = (email.bodyPreview || '').toLowerCase();
  const text    = `${subject} ${body}`;

  let score = 0;
  const signals = [];

  // Direct question / request detection
  const questionPatterns = [
    /\?/, /can you/, /could you/, /would you/, /please advise/,
    /let me know/, /your thoughts/, /what do you think/,
    /when can/, /are you available/, /do you have/,
    /please confirm/, /please review/, /need your/,
    /waiting for your/, /requesting/, /approval needed/,
  ];
  for (const p of questionPatterns) {
    if (p.test(text)) { score += 2; signals.push('question/request detected'); break; }
  }

  // VIP sender
  if (isVip) { score += 3; signals.push('VIP sender'); }

  // Sole/small recipient list (not blasted)
  const toRecipients = email.toRecipients || [];
  if (toRecipients.length <= 2) { score += 1; signals.push('direct recipient'); }

  // Urgency language
  const urgencyPatterns = [
    /urgent/, /asap/, /time.?sensitive/, /deadline/,
    /end of day/, /eod/, /by tomorrow/, /immediately/,
  ];
  for (const p of urgencyPatterns) {
    if (p.test(text)) { score += 2; signals.push('urgency language'); break; }
  }

  // Deal-related keywords
  const dealPatterns = [
    /loi/, /psa/, /acquisition/, /divestiture/, /due diligence/,
    /data room/, /offer/, /closing/, /exclusivity/,
  ];
  for (const p of dealPatterns) {
    if (p.test(text)) { score += 2; signals.push('deal-related'); break; }
  }

  // Determine tier
  let tier, color;
  if (isVip && score >= 5)  { tier = 'critical';  color = 'red';    }
  else if (score >= 4)      { tier = 'important'; color = 'orange'; }
  else if (score >= 2)      { tier = 'standard';  color = 'yellow'; }
  else                      { tier = 'low';        color = 'gray';   }

  return { score, tier, color, signals };
}

/**
 * Check whether a sent email has received a reply from someone other than the sender.
 * Filters out the user's own follow-up messages so they don't count as "replied".
 */
async function checkForReply(conversationId, sentDate) {
  try {
    // Require the reply to be from someone other than the mailbox owner
    const filter = encodeURIComponent(
      `conversationId eq '${conversationId}' and receivedDateTime gt ${sentDate} and from/emailAddress/address ne '${config.userEmail}'`
    );
    const result = await graphRequest(
      `/users/${config.userEmail}/messages?$filter=${filter}&$select=id,from&$top=1`
    );
    return result.value && result.value.length > 0;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// SHARED DASHBOARD COMPUTATION
// (Used by both /api/dashboard and /api/digest to avoid
//  fragile self-referential HTTP calls)
// ══════════════════════════════════════════════════════════════

async function getDashboardData() {
  // Inbound — last 14 days
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const inboxResult = await graphRequest(
    `/users/${config.userEmail}/mailFolders/inbox/messages?` +
    `$filter=receivedDateTime gt ${fourteenDaysAgo}&` +
    `$select=id,subject,bodyPreview,sender,from,receivedDateTime,conversationId,toRecipients,isRead,importance&` +
    `$orderby=receivedDateTime desc&$top=200`
  );
  const emails  = inboxResult.value || [];
  const inbound = { critical: [], important: [], standard: [], low: [] };

  for (const email of emails) {
    if (settings.mutedThreads.includes(email.conversationId)) continue;
    const senderAddr = email.sender?.emailAddress?.address || '';
    if (settings.mutedSenders.includes(senderAddr)) continue;

    const isVip    = settings.vipSenders.some(v => senderAddr.toLowerCase().includes(v.toLowerCase()));
    const analysis = analyzeResponseNeed(email, isVip);

    if (analysis.tier !== 'low' || !email.isRead) {
      inbound[analysis.tier].push({
        id:             email.id,
        subject:        email.subject,
        sender:         email.sender?.emailAddress,
        receivedDate:   email.receivedDateTime,
        conversationId: email.conversationId,
        tier:           analysis.tier,
        color:          analysis.color,
        signals:        analysis.signals,
        isRead:         email.isRead,
        preview:        email.bodyPreview?.substring(0, 150),
      });
    }
  }

  // Outbound — last 7 days sent items awaiting reply
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sentResult   = await graphRequest(
    `/users/${config.userEmail}/mailFolders/sentitems/messages?` +
    `$filter=sentDateTime gt ${sevenDaysAgo}&` +
    `$select=id,subject,bodyPreview,toRecipients,sentDateTime,conversationId&` +
    `$orderby=sentDateTime desc&$top=100`
  );
  const sentEmails = sentResult.value || [];
  const outbound   = [];

  for (const sent of sentEmails) {
    const hasReply  = await checkForReply(sent.conversationId, sent.sentDateTime);
    if (!hasReply) {
      const body      = (sent.bodyPreview || '').toLowerCase();
      const needsReply = /\?|please|let me know|confirm|thoughts|get back/.test(body);
      if (needsReply) {
        outbound.push({
          id:           sent.id,
          subject:      sent.subject,
          recipients:   sent.toRecipients?.map(r => r.emailAddress),
          sentDate:     sent.sentDateTime,
          conversationId: sent.conversationId,
          daysSinceSent: Math.floor((Date.now() - new Date(sent.sentDateTime)) / (24 * 60 * 60 * 1000)),
          preview:      sent.bodyPreview?.substring(0, 150),
        });
      }
    }
  }

  return {
    inbound: {
      critical:  inbound.critical,
      important: inbound.important,
      standard:  inbound.standard,
      counts: {
        critical:  inbound.critical.length,
        important: inbound.important.length,
        standard:  inbound.standard.length,
        low:       inbound.low.length,
        total:     emails.length,
      },
    },
    outbound: {
      items: outbound,
      count: outbound.length,
    },
    lastUpdated: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════

// ── Dashboard ──
app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Inbound emails detail ──
app.get('/api/inbound', async (req, res) => {
  try {
    const days   = parseInt(req.query.days) || 14;
    const tier   = req.query.tier || 'all';
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await graphRequest(
      `/users/${config.userEmail}/mailFolders/inbox/messages?` +
      `$filter=receivedDateTime gt ${cutoff}&` +
      `$select=id,subject,bodyPreview,body,sender,from,receivedDateTime,conversationId,toRecipients,ccRecipients,isRead,importance,hasAttachments&` +
      `$orderby=receivedDateTime desc&$top=500`
    );

    const items = [];
    for (const email of (result.value || [])) {
      if (settings.mutedThreads.includes(email.conversationId)) continue;
      const senderAddr = email.sender?.emailAddress?.address || '';
      if (settings.mutedSenders.includes(senderAddr)) continue;

      const isVip    = settings.vipSenders.some(v => senderAddr.toLowerCase().includes(v.toLowerCase()));
      const analysis = analyzeResponseNeed(email, isVip);

      if (tier !== 'all' && analysis.tier !== tier) continue;

      items.push({
        id:             email.id,
        subject:        email.subject,
        sender:         email.sender?.emailAddress,
        from:           email.from?.emailAddress,
        receivedDate:   email.receivedDateTime,
        conversationId: email.conversationId,
        tier:           analysis.tier,
        color:          analysis.color,
        signals:        analysis.signals,
        isRead:         email.isRead,
        importance:     email.importance,
        hasAttachments: email.hasAttachments,
        preview:        email.bodyPreview?.substring(0, 200),
        toRecipients:   email.toRecipients?.map(r => r.emailAddress),
        ccRecipients:   email.ccRecipients?.map(r => r.emailAddress),
      });
    }

    res.json({ items, count: items.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Full email thread ──
app.get('/api/email/:id', async (req, res) => {
  try {
    const msg = await graphRequest(
      `/users/${config.userEmail}/messages/${req.params.id}` +
      `?$select=id,subject,body,bodyPreview,sender,from,receivedDateTime,conversationId,toRecipients,ccRecipients,isRead,importance,hasAttachments`
    );

    const threadResult = await graphRequest(
      `/users/${config.userEmail}/messages?` +
      `$filter=conversationId eq '${msg.conversationId}'&` +
      `$select=id,subject,body,bodyPreview,sender,from,receivedDateTime,sentDateTime&` +
      `$orderby=receivedDateTime asc&$top=50`
    );

    res.json({ message: msg, thread: threadResult.value || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── AI Response Drafting ──
app.post('/api/draft', async (req, res) => {
  try {
    const { emailId, threadContext } = req.body;

    const email = await graphRequest(
      `/users/${config.userEmail}/messages/${emailId}` +
      `?$select=id,subject,body,bodyPreview,sender,from,toRecipients,ccRecipients,conversationId,receivedDateTime`
    );

    let thread = threadContext;
    if (!thread) {
      const threadResult = await graphRequest(
        `/users/${config.userEmail}/messages?` +
        `$filter=conversationId eq '${email.conversationId}'&` +
        `$select=id,subject,bodyPreview,sender,receivedDateTime&` +
        `$orderby=receivedDateTime desc&$top=10`
      );
      thread = threadResult.value;
    }

    const threadSummary = (thread || []).map(m =>
      `From: ${m.sender?.emailAddress?.name || 'Unknown'} (${m.sender?.emailAddress?.address || ''})\n` +
      `Date: ${m.receivedDateTime}\n` +
      `Preview: ${m.bodyPreview || ''}\n---`
    ).join('\n');

    const systemPrompt = `You are an AI assistant helping the CEO of Peak 10 Energy, a private upstream E&P company. You draft email responses in three styles. The CEO's name is K. McQuire.

Style guidelines:
- Professional but not stiff. This is oil and gas, not banking.
- Direct and clear. The CEO values efficiency.
- Match the formality level of the incoming email.
- Never over-explain or be verbose.
- Sign off as just the first name or initials unless it's a formal external email.

Return your response as valid JSON with this exact structure:
{
  "quickAcknowledge": {
    "subject": "Re: [original subject]",
    "body": "1-2 sentence acknowledgment"
  },
  "substantiveReply": {
    "subject": "Re: [original subject]",
    "body": "Full response addressing the content"
  },
  "delegateRedirect": {
    "subject": "Re: [original subject]",
    "body": "Response redirecting to appropriate team member",
    "suggestedDelegate": "role or name if detectable"
  },
  "analysis": {
    "senderRelationship": "description of who this person likely is",
    "urgency": "low/medium/high",
    "summary": "1-sentence summary of what they need"
  }
}`;

    const userMessage = `Draft three response options for this email:

INCOMING EMAIL:
From: ${email.sender?.emailAddress?.name} (${email.sender?.emailAddress?.address})
Subject: ${email.subject}
Body: ${email.bodyPreview}

THREAD CONTEXT (most recent first):
${threadSummary}

Generate the three response drafts as specified in the JSON format.`;

    const aiResponse = await claudeRequest(systemPrompt, userMessage, 2000);

    let drafts;
    try {
      const cleaned = aiResponse.replace(/```json\n?|\n?```/g, '').trim();
      drafts = JSON.parse(cleaned);
    } catch {
      drafts = { raw: aiResponse, parseError: true };
    }

    res.json({ emailId: email.id, subject: email.subject, sender: email.sender?.emailAddress, drafts });
  } catch (error) {
    console.error('Draft error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Send reply ──
app.post('/api/send', async (req, res) => {
  try {
    const { emailId, body } = req.body;

    // Use message.body only — passing both message and comment causes the comment
    // to be prepended as a separate plain-text block, resulting in a doubled reply.
    await graphRequest(
      `/users/${config.userEmail}/messages/${emailId}/reply`,
      'POST',
      {
        message: {
          body: { contentType: 'Text', content: body },
        },
      }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Actions (file, mute, snooze, dismiss) ──
app.post('/api/action', async (req, res) => {
  try {
    const { action, emailId, conversationId, folderId, senderAddress } = req.body;

    switch (action) {
      case 'file':
        await graphRequest(
          `/users/${config.userEmail}/messages/${emailId}/move`,
          'POST',
          { destinationId: folderId }
        );
        break;

      case 'mute-thread':
        if (!settings.mutedThreads.includes(conversationId)) {
          settings.mutedThreads.push(conversationId);
          persistSettings(settings);
        }
        break;

      case 'mute-sender':
        if (!settings.mutedSenders.includes(senderAddress)) {
          settings.mutedSenders.push(senderAddress);
          persistSettings(settings);
        }
        break;

      case 'dismiss':
        await graphRequest(
          `/users/${config.userEmail}/messages/${emailId}`,
          'PATCH',
          { isRead: true }
        );
        break;

      case 'snooze':
        // Mark read so it clears the dashboard; next scan re-surfaces after snoozeUntil
        await graphRequest(
          `/users/${config.userEmail}/messages/${emailId}`,
          'PATCH',
          { isRead: true }
        );
        break;

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    res.json({ success: true, action });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Calendar suggestions ──
app.get('/api/calendar/suggestions', async (req, res) => {
  try {
    const now      = new Date().toISOString();
    const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const calResult = await graphRequest(
      `/users/${config.userEmail}/calendarView` +
      `?startDateTime=${now}&endDateTime=${twoWeeks}` +
      `&$select=id,subject,start,end,attendees,location&$top=50`
    );

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentEmails  = await graphRequest(
      `/users/${config.userEmail}/messages?` +
      `$filter=receivedDateTime gt ${thirtyDaysAgo}&` +
      `$select=sender,from,receivedDateTime,subject,bodyPreview&` +
      `$orderby=receivedDateTime desc&$top=500`
    );

    // Build contact frequency map
    const contactFrequency = {};
    for (const email of (recentEmails.value || [])) {
      const addr = email.sender?.emailAddress?.address;
      if (!addr) continue;
      if (!contactFrequency[addr]) {
        contactFrequency[addr] = {
          name:        email.sender?.emailAddress?.name || addr,
          address:     addr,
          lastContact: email.receivedDateTime,
          count:       0,
          subjects:    [],
        };
      }
      contactFrequency[addr].count++;
      if (contactFrequency[addr].subjects.length < 3) {
        contactFrequency[addr].subjects.push(email.subject);
      }
    }

    const emailSummary = Object.values(contactFrequency)
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
      .map(c => `${c.name} (${c.address}): ${c.count} emails, last: ${c.lastContact}, topics: ${c.subjects.join('; ')}`)
      .join('\n');

    const systemPrompt = `You are a calendar intelligence system for the CEO of Peak 10 Energy, a private upstream E&P company. Analyze email patterns and suggest proactive meetings.

Two types of suggestions:
1. CADENCE: Regular relationship maintenance (investor hasn't been contacted in X weeks)
2. OPPORTUNITY: Signals from email content that suggest a meeting would advance a goal

Return a valid JSON array (no markdown fences):
[
  {
    "type": "cadence|opportunity",
    "contactName": "Name",
    "contactEmail": "email@example.com",
    "reason": "Brief rationale",
    "suggestedDuration": 30,
    "urgency": "low|medium|high",
    "suggestedTimeframe": "this week|next week|within 2 weeks"
  }
]

Be selective. Suggest only 3-7 meetings. Quality over quantity. Focus on growth-oriented and relationship-critical meetings.`;

    const rawSuggestions = await claudeRequest(
      systemPrompt,
      `Recent email activity:\n${emailSummary}\n\nExisting calendar events next 2 weeks:\n${(calResult.value || []).map(e => `${e.subject} - ${e.start?.dateTime}`).join('\n')}`,
      1500
    );

    let parsedSuggestions = [];
    try {
      const cleaned = rawSuggestions.replace(/```json\n?|\n?```/g, '').trim();
      parsedSuggestions = JSON.parse(cleaned);
    } catch {
      parsedSuggestions = [];
    }

    // Filter out suggestions the user has dismissed or snoozed
    const now2 = new Date();
    const activeSnoozed = (settings.snoozedSuggestions || [])
      .filter(s => new Date(s.until) > now2)
      .map(s => s.contactEmail);

    parsedSuggestions = parsedSuggestions.filter(s =>
      !settings.dismissedSuggestions.includes(s.contactEmail) &&
      !activeSnoozed.includes(s.contactEmail)
    );

    res.json({
      existingEvents: calResult.value || [],
      suggestions:    parsedSuggestions,
    });
  } catch (error) {
    console.error('Calendar error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Calendar actions (schedule / dismiss / snooze) ──
app.post('/api/calendar/action', async (req, res) => {
  try {
    const { action, suggestion } = req.body;
    if (!suggestion) return res.status(400).json({ error: 'suggestion is required' });

    switch (action) {
      case 'schedule': {
        // Create a calendar event with a suggested time
        const daysOut = suggestion.suggestedTimeframe === 'this week' ? 2 : 7;
        const start   = new Date();
        start.setDate(start.getDate() + daysOut);
        start.setHours(10, 0, 0, 0);
        const end = new Date(start.getTime() + (suggestion.suggestedDuration || 30) * 60 * 1000);

        await graphRequest(`/users/${config.userEmail}/events`, 'POST', {
          subject: `${suggestion.contactName} — ${suggestion.type === 'cadence' ? 'Check-in' : 'Discussion'}`,
          body:    { contentType: 'Text', content: suggestion.reason || '' },
          start:   { dateTime: start.toISOString(), timeZone: 'UTC' },
          end:     { dateTime: end.toISOString(),   timeZone: 'UTC' },
          attendees: suggestion.contactEmail ? [{
            emailAddress: { address: suggestion.contactEmail, name: suggestion.contactName },
            type: 'required',
          }] : [],
        });
        break;
      }

      case 'dismiss':
        if (!settings.dismissedSuggestions.includes(suggestion.contactEmail)) {
          settings.dismissedSuggestions.push(suggestion.contactEmail);
          persistSettings(settings);
        }
        break;

      case 'snooze': {
        // Remove any existing snooze for this contact, then add new one (1 week)
        settings.snoozedSuggestions = (settings.snoozedSuggestions || [])
          .filter(s => s.contactEmail !== suggestion.contactEmail);
        settings.snoozedSuggestions.push({
          contactEmail: suggestion.contactEmail,
          until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
        persistSettings(settings);
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown calendar action: ${action}` });
    }

    res.json({ success: true, action });
  } catch (error) {
    console.error('Calendar action error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Settings ──
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  settings = { ...settings, ...req.body };
  persistSettings(settings);
  res.json({ success: true, settings });
});

// ── Morning Digest ──
// Uses getDashboardData() directly — no fragile self-referential HTTP call.
app.get('/api/digest', async (req, res) => {
  try {
    const dashboard = await getDashboardData();

    const digest = {
      date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      summary: {
        critical:      dashboard.inbound.counts.critical,
        important:     dashboard.inbound.counts.important,
        standard:      dashboard.inbound.counts.standard,
        awaitingReply: dashboard.outbound.count,
      },
      topItems: [
        ...dashboard.inbound.critical.slice(0, 3),
        ...dashboard.inbound.important.slice(0, 2),
      ],
      outboundAlerts: dashboard.outbound.items
        .filter(i => i.daysSinceSent >= 3)
        .slice(0, 3),
    };

    res.json(digest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status:           'ok',
    timestamp:        new Date().toISOString(),
    graphConfigured:  !!config.azureClientId,
    claudeConfigured: !!config.claudeApiKey,
    model:            config.claudeModel,
  });
});

// ── Serve static frontend in production ──
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// ── Start server ──
app.listen(config.port, () => {
  console.log(`\n  Peak 10 Intelligence Server — port ${config.port}`);
  console.log(`  Graph API : ${config.azureClientId ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`  Claude API: ${config.claudeApiKey  ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`  Model     : ${config.claudeModel}\n`);
});

module.exports = app;
