# Peak 10 Energy — IT Deployment Guide
## Phase 1: Folder Structure Creation

---

### Prerequisites

Before running the folder creation script, complete these setup steps:

**1. Install PowerShell 7+**
- Download from: https://github.com/PowerShell/PowerShell/releases
- Verify: Open terminal, run `pwsh --version` — should show 7.x or later

**2. Install Microsoft Graph PowerShell SDK**
```powershell
Install-Module Microsoft.Graph -Scope CurrentUser -Force
Install-Module Microsoft.Graph.Mail -Scope CurrentUser -Force
```

**3. Azure AD App Registration** (if not already configured)

This step is only needed if you want to run the script with application permissions rather than delegated (user sign-in) permissions. For initial deployment, delegated permissions via interactive sign-in are simpler.

If using delegated permissions (recommended for Phase 1):
- No app registration needed
- The script will prompt for sign-in via browser
- The signed-in user must have a mailbox and standard mail permissions

If using application permissions (needed for Phase 2 cataloging):
1. Go to Azure Portal → Azure Active Directory → App Registrations → New Registration
2. Name: `Peak10-OutlookAutomation`
3. Supported account types: "Accounts in this organizational directory only"
4. Redirect URI: Leave blank for now
5. After creation, go to **API Permissions**:
   - Add permission → Microsoft Graph → Application permissions
   - Add: `Mail.ReadWrite`, `MailboxSettings.ReadWrite`, `Mail.Read`
   - Click "Grant admin consent"
6. Go to **Certificates & secrets** → New client secret
   - Description: `Peak10-Automation`
   - Expiry: 12 months
   - **Copy and securely store the secret value immediately** — it won't be shown again
7. Note down:
   - **Application (client) ID**: Found on the Overview page
   - **Directory (tenant) ID**: Found on the Overview page  
   - **Client Secret**: From step 6

---

### Running the Folder Creation Script

**Step 1: Open PowerShell 7**
```
pwsh
```

**Step 2: Navigate to the script directory**
```powershell
cd C:\Path\To\Peak10Scripts
```

**Step 3: Run the script**
```powershell
.\Create-Peak10FolderStructure_v1.1.ps1
```

**Step 4: Authenticate**
- A browser window will open for Microsoft sign-in
- Sign in as **K. McQuire's Peak 10 account** first
- For personal Gmail accounts, the script will prompt you to re-authenticate

**Step 5: Select accounts**
- Choose option 1 (Peak 10 only), 2 (personal only), or 3 (all)
- For Peak 10: Sign in with the Peak 10 work account
- For personal Gmail accounts: Sign in with each Gmail account when prompted

**Step 6: Verify**
- Open Outlook (desktop) and check that all folders appear
- Check Outlook mobile and verify folder visibility
- Folders should appear in this order:
  - ⚠ ACTION REQUIRED
  - ⏳ WAITING ON REPLY
  - 📋 REVIEW - READ
  - 📅 MEETING PREP
  - 01 - Operations (with subfolders)
  - 02 - Land & Title (with subfolders)
  - ... through 11 - Industry & External
  - Archive (with mirrored structure)

---

### Output Files

The script creates JSON files in the current directory:

| File | Purpose |
|------|---------|
| `Peak10_FolderMap.json` | Maps folder names to Graph API folder IDs for the Peak 10 account |
| `kmcquire_utexas_edu_FolderMap.json` | Folder IDs for the utexas.edu account |
| `kdmcquire_gmail_com_FolderMap.json` | Folder IDs for the Gmail account |

**These JSON files are required by the Phase 2 cataloging scripts.** Keep them in the same directory.

---

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Insufficient privileges" error | Ensure the signed-in account has a mailbox. For app permissions, verify admin consent was granted. |
| Folders don't appear on mobile | Force-sync Outlook mobile: Settings → Account → Reset Account. Folders may take up to 15 minutes to sync. |
| Emoji characters in folder names display incorrectly | This is a font rendering issue on older Windows. The folders will still work. If unacceptable, the script can be modified to use text prefixes instead (e.g., "[!] ACTION REQUIRED"). |
| Rate limiting errors (429) | The script includes 200ms delays between API calls. If you still hit limits, increase the `Start-Sleep` values in the script to 500ms. |
| Gmail account authentication fails | Ensure the Gmail accounts are configured as connected accounts in Outlook. The Graph API accesses them through the Outlook connection, not directly through Gmail. |

---

### Security Notes

- The script uses **delegated permissions** — it acts as the signed-in user, with only that user's mailbox access
- No credentials are stored in the script
- The folder map JSON files contain folder IDs (not sensitive), but should be kept secure as they're needed for Phase 2
- For Phase 2 (cataloging scripts), application permissions will be required — the Azure AD app registration in step 3 above prepares for this

---

### Contact

If you encounter issues not covered above, document the error message and the step where it occurred. Provide this to Claude for troubleshooting.
