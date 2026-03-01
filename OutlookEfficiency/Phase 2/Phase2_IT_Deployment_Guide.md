# Peak 10 Energy — Phase 2 IT Deployment Guide
## Email Cataloging, Rules & Automation

---

### Overview

Phase 2 has three stages executed in order:

| Stage | Script / Action | Purpose |
|-------|----------------|---------|
| **A** | `Invoke-Peak10Cataloging.ps1 -Mode Preview` | Dry run — classifies all 57K emails without moving anything. Generates a report. |
| **B** | CEO reviews report, approves | Gate check before executing moves |
| **C** | `Invoke-Peak10Cataloging.ps1 -Mode Execute` | Moves emails to approved folders |
| **D** | Create Outlook rules | Ongoing auto-filing for known senders |
| **E** | Create Power Automate flows | Ongoing keyword-based classification |
| **F** | `Invoke-Peak10Archive.ps1 -Mode Preview` then `-Mode Execute` | Mirror structure to Archive |

---

### Prerequisites

All prerequisites from Phase 1 still apply, plus:

**1. Microsoft Graph PowerShell SDK modules**
```powershell
Install-Module Microsoft.Graph.Mail -Scope CurrentUser -Force
Install-Module Microsoft.Graph.Users -Scope CurrentUser -Force
```

**2. Phase 1 folder map files**
The following JSON files must be in the same directory as the scripts:
- `Peak10_FolderMap.json`
- `kmcquire_utexas_edu_FolderMap.json` (if processing personal accounts)
- `kdmcquire_gmail_com_FolderMap.json` (if processing personal accounts)

**3. Sufficient permissions**
The signed-in account must have `Mail.ReadWrite` delegated permissions.

---

### Stage A: Preview Cataloging (Dry Run)

**This is critical. Always run Preview first.**

```powershell
# Navigate to script directory
cd C:\Path\To\Peak10Scripts

# Run preview — this classifies ALL emails but moves NOTHING
.\Invoke-Peak10Cataloging.ps1 -Mode Preview

# Optional: Limit to first 1000 emails for a quick test
.\Invoke-Peak10Cataloging.ps1 -Mode Preview -MaxEmails 1000
```

**What happens:**
1. Script connects to Microsoft Graph (browser sign-in prompt)
2. Fetches all inbox messages (paginated, ~50 at a time)
3. Classifies each email using weighted keyword matching
4. Groups emails by conversation thread for consistent filing
5. Generates a CSV report: `CatalogingReport_[timestamp].csv`

**The report contains:**
| Column | Description |
|--------|-------------|
| Subject | Email subject line |
| Sender | Sender email address |
| ReceivedDate | When the email was received |
| Folder | Proposed destination folder |
| Subfolder | Proposed subfolder (for Finance emails) |
| Confidence | Confidence score (0-100) |
| ConfidenceLevel | High (≥85), Medium (60-84), Low (<60) |
| MatchedKeywords | Which keywords triggered the classification |

**Review the report in Excel.** Sort by ConfidenceLevel to see Low-confidence items first. Check for obvious misclassifications. Send the report to CEO for review.

**Expected distribution:**
- High confidence: ~50-60% of emails
- Medium confidence: ~20-30%
- Low / Unclassified: ~10-20%
- Thread-matched: ~10-15% (classified based on thread consistency)

---

### Stage B: CEO Review

Send the CSV report to CEO with these instructions:
1. Open in Excel
2. Filter by `ConfidenceLevel = Low` — review these first
3. Filter by `ConfidenceLevel = Medium` — spot-check 20-30 of these
4. Look for patterns: are certain senders consistently misclassified?
5. Approve the overall results or flag corrections needed

---

### Stage C: Execute Cataloging

**Only after CEO approves the preview report:**

```powershell
# Execute — this MOVES emails to folders
.\Invoke-Peak10Cataloging.ps1 -Mode Execute
```

**What happens:**
1. High-confidence emails are moved to their classified folders
2. Medium-confidence emails are moved but flagged for review
3. Low-confidence / unclassified emails stay in the Inbox for manual filing
4. A new report is generated showing what was moved

**For personal accounts:**
```powershell
# Disconnect and re-authenticate for each account
Disconnect-MgGraph

# utexas.edu account
.\Invoke-Peak10Cataloging.ps1 -Mode Preview -Account utexas -FolderMapPath .\kmcquire_utexas_edu_FolderMap.json
# Review report, then:
.\Invoke-Peak10Cataloging.ps1 -Mode Execute -Account utexas -FolderMapPath .\kmcquire_utexas_edu_FolderMap.json

# Gmail account
.\Invoke-Peak10Cataloging.ps1 -Mode Preview -Account gmail -FolderMapPath .\kdmcquire_gmail_com_FolderMap.json
# Review report, then:
.\Invoke-Peak10Cataloging.ps1 -Mode Execute -Account gmail -FolderMapPath .\kdmcquire_gmail_com_FolderMap.json
```

**Estimated runtime:** For 57,000 emails, preview takes ~20-40 minutes. Execution takes ~1-2 hours depending on API rate limits.

---

### Stage D: Create Outlook Rules

After cataloging is complete, create the ongoing rules defined in the Rules & Flows document.

**Option 1: Manual creation (simplest)**
In Outlook desktop:
1. Home > Rules > Manage Rules & Alerts
2. New Rule > Apply rule on messages I receive
3. Configure each rule per the specifications in the Rules & Flows document

**Option 2: PowerShell via Exchange Online**
```powershell
# Connect to Exchange Online
Connect-ExchangeOnline -UserPrincipalName admin@peak10energy.com

# Example: Create a rule for RRC emails
New-InboxRule -Name "RRC to Regulatory" `
    -FromAddressContainsWords "rrc.texas.gov" `
    -MoveToFolder "08 - Regulatory & Compliance\RRC - State Agencies" `
    -Mailbox "kmcquire@peak10energy.com"

# Repeat for each rule in the Rules & Flows document
```

**Important:** Create sender-based rules first (Priority 1), then keyword rules (Priority 2-3). Use the Sender Frequency Report from the cataloging output to identify the most common senders per folder.

---

### Stage E: Create Power Automate Flows

1. Go to https://flow.microsoft.com
2. Sign in with the Peak 10 account
3. Create each flow per the specifications in the Rules & Flows document

**For each flow:**
1. Click "Create" > "Automated cloud flow"
2. Name the flow (e.g., "Engineering Keyword Classifier")
3. Add trigger: "When a new email arrives (V3)" from Office 365 Outlook connector
4. Add condition: Check subject and body for specified keywords
5. Add action: "Move email (V2)" to the specified folder
6. Save and test

**For scheduled flows (Reply Tracker, Inbox Cleanup):**
1. Click "Create" > "Scheduled cloud flow"
2. Set the recurrence per the specs (e.g., every 4 hours, every Friday at 2 PM)
3. Configure the Graph API calls as specified

---

### Stage F: Archive Mirroring

After the working folder structure is confirmed stable (give it 1-2 weeks):

```powershell
# Preview archive — shows what would move
.\Invoke-Peak10Archive.ps1 -Mode Preview

# Execute archive
.\Invoke-Peak10Archive.ps1 -Mode Execute

# Custom threshold (e.g., 120 days instead of 90)
.\Invoke-Peak10Archive.ps1 -Mode Execute -DaysThreshold 120
```

---

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Script hangs during fetching | Check internet connection. The script paginates 50 emails at a time with rate limiting. For 57K emails, expect 20-40 minutes. |
| "429 Too Many Requests" error | The script handles this with automatic retry. If persistent, increase `Start-Sleep` values in the script. |
| Emails not appearing in new folders on mobile | Force-sync Outlook mobile. Large folder moves may take 15-30 minutes to propagate. |
| Confidence scores seem low | Check if the email language uses non-standard terminology. Add custom keywords to the `$ClassificationRules` hashtable in the script. |
| Misclassified emails | Note the pattern (sender + subject). Add a new Outlook rule for the sender, or add keywords to the appropriate classification rule set. |
| Power Automate flow not triggering | Check that the flow is turned on. Verify the Outlook connector has proper permissions. Check flow run history for errors. |

---

### Post-Deployment Verification

After all stages complete:

- [ ] Verify all 11 functional folders + subfolders have emails
- [ ] Verify Archive mirrors the structure
- [ ] Verify action-state folders are accessible on both desktop and mobile
- [ ] Verify at least 3 Outlook rules are auto-filing correctly (send a test email)
- [ ] Verify at least 1 Power Automate flow triggers correctly
- [ ] Confirm low-confidence / unclassified emails are still in Inbox for CEO review
- [ ] Send completion report to CEO

---

### Files Delivered

| File | Purpose |
|------|---------|
| `Invoke-Peak10Cataloging.ps1` | Main cataloging script (Preview + Execute) |
| `Invoke-Peak10Archive.ps1` | Quarterly archive script |
| `Phase2_Rules_and_Flows.docx` | Outlook rules & Power Automate flow specs |
| `Phase2_IT_Deployment_Guide.md` | This document |
| `Create-Peak10FolderStructure_v1.1.ps1` | Phase 1 folder creation (already delivered) |
