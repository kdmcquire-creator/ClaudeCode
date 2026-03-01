<#
.SYNOPSIS
    Peak 10 Energy - Email Cataloging Engine
    Classifies and files ~57,000 emails into the approved folder structure.

.DESCRIPTION
    Uses Microsoft Graph API to:
    1. Read all inbox emails (paginated)
    2. Classify each email by functional area using sender, subject, and body keywords
    3. Apply confidence scoring (High >= 85%, Medium 60-84%, Low < 60%)
    4. Group by conversation thread for consistent filing
    5. Move emails to appropriate folders
    6. Generate a detailed report

.PREREQUISITES
    - PowerShell 7.0+
    - Microsoft Graph PowerShell SDK
    - Peak10_FolderMap.json from Phase 1 script
    - Azure AD App with Mail.ReadWrite permissions

.USAGE
    .\Invoke-Peak10Cataloging.ps1 -Mode Preview    # Dry run - shows what would move, moves nothing
    .\Invoke-Peak10Cataloging.ps1 -Mode Execute     # Moves emails
    .\Invoke-Peak10Cataloging.ps1 -Mode ReviewOnly  # Process only low-confidence items for manual review

.NOTES
    Author: Claude (Anthropic) for Peak 10 Energy
    Version: 1.0 | February 2026
#>

#Requires -Version 7.0

param(
    [ValidateSet("Preview", "Execute", "ReviewOnly")]
    [string]$Mode = "Preview",

    [string]$FolderMapPath = ".\Peak10_FolderMap.json",

    [int]$BatchSize = 50,

    [int]$MaxEmails = 0,  # 0 = all emails

    [string]$ReportPath = ".\CatalogingReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv",

    [string]$Account = "Peak10"  # Peak10, utexas, gmail
)

$ErrorActionPreference = "Stop"

# ══════════════════════════════════════════════════════════════
# COLOR OUTPUT
# ══════════════════════════════════════════════════════════════
function Write-Status($msg) { Write-Host "  [*] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "  [+] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  [-] $msg" -ForegroundColor Red }
function Write-Detail($msg) { Write-Host "      $msg" -ForegroundColor DarkGray }

# ══════════════════════════════════════════════════════════════
# CLASSIFICATION ENGINE
# ══════════════════════════════════════════════════════════════

# Keyword dictionaries - each key is a folder name, value is an array of
# [keyword, weight] pairs. Weight 1-3 where 3 = strongest signal.
$ClassificationRules = @{

    "01 - Operations" = @(
        @("production report", 3), @("daily report", 3), @("field report", 3),
        @("BOPD", 3), @("MCFD", 3), @("water cut", 3), @("downtime", 2),
        @("workover", 3), @("pump", 1), @("rod", 1), @("tubing", 2),
        @("flowback", 3), @("facility", 1), @("tank battery", 3),
        @("compressor", 2), @("pipeline", 2), @("spill", 3), @("incident", 2),
        @("HSE", 3), @("safety", 2), @("injection", 2), @("disposal", 2),
        @("trucking", 2), @("gauger", 3), @("pumper", 3),
        @("production", 1), @("well status", 3), @("equipment", 1)
    )

    "02 - Land & Title" = @(
        @("lease", 2), @("mineral", 2), @("royalty", 2), @("surface use", 3),
        @("SUA", 3), @("right of way", 3), @("ROW", 2), @("title opinion", 3),
        @("title", 1), @("curative", 3), @("division order", 3), @("DO ", 2),
        @("DOTO", 3), @("pooling", 3), @("unitization", 3), @("landman", 3),
        @("abstract", 2), @("runsheet", 3), @("county", 1), @("recording", 2),
        @("HBP", 3), @("bonus", 2), @("rental", 1), @("shut-in", 3),
        @("top lease", 3), @("farmout", 3), @("tract schedule", 3),
        @("lease schedule", 3), @("owner relations", 3), @("mineral owner", 3),
        @("surface owner", 3)
    )

    "03 - Engineering & Geology" = @(
        @("drill", 2), @("spud", 3), @("TD", 2), @("completion", 2),
        @("frac", 3), @("perf", 2), @("casing", 2), @("cement", 2),
        @("mud", 1), @("BHA", 3), @("directional", 2), @("lateral", 2),
        @("reservoir", 3), @("EUR", 3), @("IP", 2), @("decline", 2),
        @("type curve", 3), @("AFE", 3), @("authorization for expenditure", 3),
        @("geologist", 3), @("seismic", 3), @("log", 1), @("core", 2),
        @("formation", 2), @("bench", 2), @("target", 1), @("spacing", 2),
        @("DSU", 3), @("well plan", 3), @("drilling program", 3)
    )

    "04 - Business Development & Deals" = @(
        @("acquisition", 3), @("divestiture", 3), @("farm-in", 3),
        @("farm-out", 3), @("LOI", 3), @("letter of intent", 3),
        @("PSA", 3), @("purchase and sale", 3), @("due diligence", 3),
        @("data room", 3), @("bid", 2), @("offer", 2), @("prospect", 2),
        @("deal", 2), @("package", 1), @("marketed", 3), @("broker", 2),
        @("A&D", 3), @("closing", 2), @("earnest", 3), @("deposit", 1),
        @("exclusivity", 3), @("indemnity", 2)
    )

    "05 - Investors & Capital" = @(
        @("investor", 3), @("capital call", 3), @("distribution", 2),
        @("PPM", 3), @("subscription", 2), @("equity", 2), @("fund", 1),
        @("LP", 2), @("limited partner", 3), @("lender", 2), @("bank", 1),
        @("borrowing base", 3), @("revolver", 3), @("credit facility", 3),
        @("covenant", 3), @("board", 2), @("advisory", 1),
        @("capital raise", 3), @("commitment", 2), @("waterfall", 3),
        @("RBL", 3), @("ABS", 2), @("warehouse facility", 3),
        @("bridge loan", 3)
    )

    "06 - JV & Partners" = @(
        @("JOA", 3), @("joint operating", 3), @("working interest", 3),
        @("WI", 2), @("NRI", 2), @("non-op", 3), @("non-consent", 3),
        @("AFE election", 3), @("JIB", 2), @("joint interest billing", 3),
        @("operator", 1), @("non-operator", 3), @("consent", 2),
        @("cash call", 3), @("overhead", 1), @("COPAS", 3), @("payout", 2)
    )

    "07 - Legal" = @(
        @("attorney", 3), @("counsel", 2), @("litigation", 3),
        @("lawsuit", 3), @("claim", 2), @("damages", 3),
        @("contract", 1), @("agreement", 1), @("amendment", 2),
        @("corporate", 1), @("bylaws", 3), @("operating agreement", 2),
        @("LLC", 1), @("entity", 1), @("formation", 2),
        @("dissolution", 3), @("power of attorney", 3), @("legal opinion", 3)
    )

    "08 - Regulatory & Compliance" = @(
        @("RRC", 3), @("Railroad Commission", 3), @("permit", 2),
        @("W-2", 2), @("H-10", 3), @("P-4", 3), @("W-1", 3),
        @("completion report", 2), @("plugging", 3), @("bonding", 2),
        @("surety", 3), @("TCEQ", 3), @("EPA", 2), @("air permit", 3),
        @("water disposal permit", 3), @("injection permit", 3),
        @("compliance", 2), @("inspection", 2), @("violation", 3), @("notice", 1)
    )

    "09 - Finance & Accounting" = @(
        @("invoice", 2), @("payment", 1), @("AP", 2), @("AR", 2),
        @("accounts payable", 3), @("accounts receivable", 3),
        @("revenue", 2), @("royalty check", 3), @("severance tax", 3),
        @("ad valorem", 3), @("audit", 2), @("CPA", 3),
        @("financial statement", 3), @("insurance", 2), @("COI", 3),
        @("certificate of insurance", 3), @("wire", 2), @("ACH", 2),
        @("bank statement", 3), @("1099", 3), @("K-1", 3),
        @("tax return", 3), @("check run", 3), @("month-end", 3),
        @("general ledger", 3), @("GL", 2)
    )

    "10 - People & Admin" = @(
        @("hire", 2), @("recruit", 3), @("resume", 3), @("benefits", 2),
        @("401k", 3), @("payroll", 3), @("PTO", 3), @("office", 1),
        @("furniture", 2), @("IT", 1), @("software", 1), @("license", 1),
        @("computer", 1), @("phone", 1), @("admin", 1), @("vendor", 1),
        @("consultant", 1), @("contractor", 1), @("HR", 2),
        @("employee", 2), @("onboarding", 3), @("termination", 3)
    )

    "11 - Industry & External" = @(
        @("TIPRO", 3), @("IPAA", 3), @("PBPA", 3), @("NAPE", 3),
        @("conference", 2), @("convention", 3), @("speaker", 2),
        @("panel", 2), @("membership", 2), @("dues", 3),
        @("market report", 3), @("commodity", 2), @("WTI", 2),
        @("Henry Hub", 3), @("rig count", 3), @("industry", 1),
        @("association", 2), @("networking", 2), @("introduction", 2),
        @("media", 2), @("press", 2), @("interview", 2)
    )
}

# Finance sub-classification for the three subfolders
$FinanceSubRules = @{
    "JIB + Invoices" = @(
        @("JIB", 3), @("joint interest billing", 3), @("invoice", 3),
        @("vendor invoice", 3), @("service invoice", 3), @("billing", 2)
    )
    "Revenue + AP" = @(
        @("revenue", 3), @("royalty check", 3), @("accounts payable", 3),
        @("AP", 2), @("check run", 3), @("payment", 2), @("wire", 2),
        @("ACH", 2), @("distribution", 2)
    )
    "Accounting" = @(
        @("financial statement", 3), @("month-end", 3), @("general ledger", 3),
        @("GL", 2), @("CPA", 3), @("reconciliation", 3), @("balance sheet", 3),
        @("income statement", 3), @("trial balance", 3)
    )
    "Tax" = @(
        @("tax", 3), @("1099", 3), @("K-1", 3), @("tax return", 3),
        @("severance tax", 3), @("ad valorem", 3), @("deduction", 2),
        @("depreciation", 2)
    )
    "Insurance" = @(
        @("insurance", 3), @("COI", 3), @("certificate of insurance", 3),
        @("policy", 2), @("premium", 3), @("coverage", 2), @("claim", 2)
    )
    "Audit" = @(
        @("audit", 3), @("auditor", 3), @("examination", 2),
        @("internal controls", 3), @("COPAS audit", 3)
    )
}

# Personal account classification
$PersonalClassificationRules = @{
    "Financial - Banking" = @(
        @("bank", 2), @("statement", 1), @("investment", 2),
        @("brokerage", 3), @("credit card", 3), @("Schwab", 3),
        @("Fidelity", 3), @("Vanguard", 3), @("tax", 2),
        @("1040", 3), @("mortgage", 3), @("loan", 2)
    )
    "Property - Real Estate" = @(
        @("HOA", 3), @("property", 1), @("utility", 2), @("electric", 2),
        @("water", 1), @("gas", 1), @("home", 1), @("house", 1),
        @("maintenance", 1), @("repair", 1), @("escrow", 3), @("appraisal", 3)
    )
    "Education - Alumni" = @(
        @("UT", 2), @("Texas", 1), @("alumni", 3), @("Longhorn", 3),
        @("education", 2), @("course", 1), @("certification", 2),
        @("university", 2), @("degree", 2), @("reunion", 3)
    )
    "Health & Wellness" = @(
        @("doctor", 3), @("medical", 3), @("dental", 3),
        @("prescription", 3), @("pharmacy", 3), @("health", 1),
        @("EOB", 3), @("gym", 3), @("fitness", 2)
    )
    "Travel" = @(
        @("flight", 3), @("hotel", 2), @("reservation", 2),
        @("booking", 2), @("airline", 3), @("loyalty", 2),
        @("miles", 2), @("points", 1), @("rental", 1),
        @("itinerary", 3), @("passport", 3), @("TSA", 3)
    )
    "Subscriptions & Services" = @(
        @("subscription", 3), @("Netflix", 3), @("Spotify", 3),
        @("Amazon", 2), @("order", 1), @("delivery", 2),
        @("warranty", 3), @("account", 1), @("renewal", 3)
    )
    "Family & Personal" = @(
        @("family", 2), @("personal", 1), @("estate", 2),
        @("will", 1), @("trust", 2), @("charity", 3),
        @("donation", 3), @("gift", 2)
    )
    "Professional - Networking" = @(
        @("LinkedIn", 3), @("advisory", 2), @("board", 1),
        @("mentor", 3), @("networking", 2), @("professional", 1),
        @("reference", 2), @("recommendation", 2)
    )
}

# ══════════════════════════════════════════════════════════════
# CLASSIFICATION FUNCTIONS
# ══════════════════════════════════════════════════════════════

function Get-EmailClassification {
    <#
    .SYNOPSIS
        Classifies an email into a functional folder based on weighted keyword matching.
        Returns folder name, confidence score, and matched keywords.
    #>
    param(
        [string]$Subject,
        [string]$BodyPreview,
        [string]$SenderAddress,
        [string]$SenderName,
        [hashtable]$Rules
    )

    $scores = @{}
    $matchDetails = @{}
    $textToSearch = "$Subject $BodyPreview $SenderName".ToLower()

    foreach ($folder in $Rules.Keys) {
        $score = 0
        $matches = @()

        foreach ($rule in $Rules[$folder]) {
            $keyword = $rule[0].ToLower()
            $weight = $rule[1]

            # Subject matches get 2x weight (subject is more indicative)
            if ($Subject -and $Subject.ToLower() -match [regex]::Escape($keyword)) {
                $score += ($weight * 2)
                $matches += "$keyword (subject, w=$weight)"
            }
            # Body/preview matches get 1x weight
            elseif ($textToSearch -match [regex]::Escape($keyword)) {
                $score += $weight
                $matches += "$keyword (body, w=$weight)"
            }
        }

        if ($score -gt 0) {
            $scores[$folder] = $score
            $matchDetails[$folder] = $matches
        }
    }

    if ($scores.Count -eq 0) {
        return @{
            Folder = "UNCLASSIFIED"
            Confidence = 0
            ConfidenceLevel = "Low"
            MatchedKeywords = @()
            AllScores = @{}
        }
    }

    # Get the top-scoring folder
    $sorted = $scores.GetEnumerator() | Sort-Object Value -Descending
    $topFolder = $sorted | Select-Object -First 1
    $totalPossible = ($Rules[$topFolder.Name] | ForEach-Object { $_[1] * 2 } | Measure-Object -Sum).Sum
    $confidence = [math]::Min(100, [math]::Round(($topFolder.Value / [math]::Max(1, $totalPossible * 0.3)) * 100))

    # Check separation from second-place (ambiguity check)
    if ($sorted.Count -ge 2) {
        $secondScore = ($sorted | Select-Object -Skip 1 -First 1).Value
        $separation = $topFolder.Value - $secondScore
        if ($separation -lt 3 -and $confidence -gt 60) {
            $confidence = [math]::Min($confidence, 70)  # Cap confidence when ambiguous
        }
    }

    $confidenceLevel = switch {
        ($confidence -ge 85) { "High" }
        ($confidence -ge 60) { "Medium" }
        default { "Low" }
    }

    return @{
        Folder = $topFolder.Name
        Confidence = $confidence
        ConfidenceLevel = $confidenceLevel
        MatchedKeywords = $matchDetails[$topFolder.Name]
        AllScores = $scores
    }
}

function Get-FinanceSubfolder {
    <#
    .SYNOPSIS
        For emails classified to 09 - Finance & Accounting, determines the specific subfolder.
    #>
    param(
        [string]$Subject,
        [string]$BodyPreview
    )

    $textToSearch = "$Subject $BodyPreview".ToLower()
    $scores = @{}

    foreach ($sub in $FinanceSubRules.Keys) {
        $score = 0
        foreach ($rule in $FinanceSubRules[$sub]) {
            $keyword = $rule[0].ToLower()
            $weight = $rule[1]
            if ($textToSearch -match [regex]::Escape($keyword)) {
                $score += $weight
            }
        }
        if ($score -gt 0) { $scores[$sub] = $score }
    }

    if ($scores.Count -eq 0) { return "Accounting" }  # Default subfolder
    return ($scores.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Name
}

# ══════════════════════════════════════════════════════════════
# GRAPH API HELPERS
# ══════════════════════════════════════════════════════════════

function Get-AllInboxMessages {
    <#
    .SYNOPSIS
        Retrieves all messages from the inbox using pagination.
    #>
    param(
        [string]$UserId = "me",
        [int]$PageSize = 50,
        [int]$MaxMessages = 0
    )

    Write-Status "Fetching inbox messages (page size: $PageSize)..."

    $allMessages = @()
    $page = 1
    $uri = "https://graph.microsoft.com/v1.0/users/$UserId/mailFolders/inbox/messages?`$top=$PageSize&`$select=id,subject,bodyPreview,sender,from,receivedDateTime,conversationId,isRead,importance,flag&`$orderby=receivedDateTime desc"

    do {
        try {
            $response = Invoke-MgGraphRequest -Method GET -Uri $uri
            $messages = $response.value

            if ($messages) {
                $allMessages += $messages
                Write-Detail "Page $page : Retrieved $($messages.Count) messages (Total: $($allMessages.Count))"
            }

            $uri = $response.'@odata.nextLink'
            $page++

            # Rate limiting
            Start-Sleep -Milliseconds 100

            # Check max limit
            if ($MaxMessages -gt 0 -and $allMessages.Count -ge $MaxMessages) {
                Write-Warn "Reached max message limit ($MaxMessages). Stopping fetch."
                $allMessages = $allMessages | Select-Object -First $MaxMessages
                $uri = $null
            }
        }
        catch {
            Write-Fail "Error fetching page $page : $($_.Exception.Message)"
            if ($_.Exception.Message -match "429") {
                Write-Warn "Rate limited. Waiting 30 seconds..."
                Start-Sleep -Seconds 30
            }
            else {
                $uri = $null
            }
        }
    } while ($uri)

    Write-Success "Total messages retrieved: $($allMessages.Count)"
    return $allMessages
}

function Move-EmailToFolder {
    <#
    .SYNOPSIS
        Moves an email to a specified folder using Graph API.
    #>
    param(
        [string]$MessageId,
        [string]$DestinationFolderId,
        [string]$UserId = "me"
    )

    try {
        $body = @{ destinationId = $DestinationFolderId } | ConvertTo-Json
        Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/users/$UserId/messages/$MessageId/move" `
            -Body $body -ContentType "application/json" | Out-Null
        return $true
    }
    catch {
        Write-Fail "Failed to move message $MessageId : $($_.Exception.Message)"
        return $false
    }
}

# ══════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ══════════════════════════════════════════════════════════════

function Main {
    Write-Host ""
    Write-Host "+" -NoNewline -ForegroundColor Cyan
    Write-Host ("=" * 60) -NoNewline -ForegroundColor Cyan
    Write-Host "+" -ForegroundColor Cyan
    Write-Host "|  PEAK 10 ENERGY - Email Cataloging Engine" -ForegroundColor Cyan
    Write-Host "|  Mode: $Mode" -ForegroundColor Cyan
    Write-Host "+" -NoNewline -ForegroundColor Cyan
    Write-Host ("=" * 60) -NoNewline -ForegroundColor Cyan
    Write-Host "+" -ForegroundColor Cyan
    Write-Host ""

    # ── Step 1: Load folder map ──
    Write-Status "Loading folder map from $FolderMapPath..."
    if (-not (Test-Path $FolderMapPath)) {
        Write-Fail "Folder map not found at $FolderMapPath"
        Write-Fail "Run Create-Peak10FolderStructure.ps1 first to generate the folder map."
        return
    }
    $folderMap = (Get-Content $FolderMapPath -Raw | ConvertFrom-Json).Folders
    Write-Success "Folder map loaded. $($folderMap.PSObject.Properties.Count) folders mapped."

    # ── Step 2: Connect to Graph ──
    Write-Status "Connecting to Microsoft Graph..."
    try {
        Connect-MgGraph -Scopes "Mail.ReadWrite" -NoWelcome
        $ctx = Get-MgContext
        Write-Success "Connected as: $($ctx.Account)"
    }
    catch {
        Write-Fail "Connection failed: $($_.Exception.Message)"
        return
    }

    # ── Step 3: Select classification rules ──
    $rules = switch ($Account) {
        "Peak10" { $ClassificationRules }
        "utexas" { $PersonalClassificationRules }
        "gmail"  { $PersonalClassificationRules }
        default  { $ClassificationRules }
    }

    # ── Step 4: Fetch all messages ──
    $messages = Get-AllInboxMessages -PageSize $BatchSize -MaxMessages $MaxEmails

    if ($messages.Count -eq 0) {
        Write-Warn "No messages found in inbox."
        return
    }

    # ── Step 5: Classify all messages ──
    Write-Status "Classifying $($messages.Count) messages..."

    $results = @()
    $conversationFolders = @{}  # Track folder assignments by conversation ID
    $counter = 0

    foreach ($msg in $messages) {
        $counter++
        if ($counter % 500 -eq 0) {
            Write-Detail "Classified $counter / $($messages.Count)..."
        }

        $subject = $msg.subject ?? ""
        $bodyPreview = $msg.bodyPreview ?? ""
        $senderAddress = $msg.sender?.emailAddress?.address ?? ""
        $senderName = $msg.sender?.emailAddress?.name ?? ""
        $convId = $msg.conversationId ?? ""

        # Check if this conversation already has a folder assignment
        if ($convId -and $conversationFolders.ContainsKey($convId)) {
            $classification = $conversationFolders[$convId]
            $classification.ConfidenceLevel = "Thread"
        }
        else {
            $classification = Get-EmailClassification `
                -Subject $subject `
                -BodyPreview $bodyPreview `
                -SenderAddress $senderAddress `
                -SenderName $senderName `
                -Rules $rules

            # Store for thread consistency
            if ($convId -and $classification.Folder -ne "UNCLASSIFIED") {
                $conversationFolders[$convId] = $classification
            }
        }

        # Determine subfolder for Finance
        $subfolder = ""
        if ($classification.Folder -eq "09 - Finance & Accounting") {
            $subfolder = Get-FinanceSubfolder -Subject $subject -BodyPreview $bodyPreview
        }

        $results += [PSCustomObject]@{
            MessageId       = $msg.id
            Subject         = $subject
            Sender          = $senderAddress
            ReceivedDate    = $msg.receivedDateTime
            ConversationId  = $convId
            Folder          = $classification.Folder
            Subfolder       = $subfolder
            Confidence      = $classification.Confidence
            ConfidenceLevel = $classification.ConfidenceLevel
            MatchedKeywords = ($classification.MatchedKeywords -join "; ")
            IsRead          = $msg.isRead
            Importance      = $msg.importance
        }
    }

    Write-Success "Classification complete."

    # ── Step 6: Summary ──
    Write-Host ""
    Write-Host "  ┌──────────────────────────────────────────┐" -ForegroundColor White
    Write-Host "  │  CLASSIFICATION SUMMARY                  │" -ForegroundColor White
    Write-Host "  └──────────────────────────────────────────┘" -ForegroundColor White

    $grouped = $results | Group-Object Folder | Sort-Object Count -Descending
    foreach ($g in $grouped) {
        $pct = [math]::Round(($g.Count / $results.Count) * 100, 1)
        Write-Host "    $($g.Name.PadRight(35)) $($g.Count.ToString().PadLeft(6))  ($pct%)" -ForegroundColor $(
            if ($g.Name -eq "UNCLASSIFIED") { "Red" } else { "White" }
        )
    }

    Write-Host ""
    $byConfidence = $results | Group-Object ConfidenceLevel
    foreach ($c in $byConfidence) {
        $color = switch ($c.Name) {
            "High" { "Green" }
            "Medium" { "Yellow" }
            "Thread" { "Cyan" }
            default { "Red" }
        }
        Write-Host "    $($c.Name.PadRight(12)) confidence: $($c.Count) emails" -ForegroundColor $color
    }

    # ── Step 7: Export report ──
    Write-Status "Exporting report to $ReportPath..."
    $results | Export-Csv -Path $ReportPath -NoTypeInformation -Encoding UTF8
    Write-Success "Report exported."

    # ── Step 8: Execute moves (if not preview) ──
    if ($Mode -eq "Preview") {
        Write-Host ""
        Write-Warn "PREVIEW MODE - No emails were moved."
        Write-Warn "Review the report at: $ReportPath"
        Write-Warn "Run with -Mode Execute to move emails."
        Write-Host ""
        return
    }

    if ($Mode -eq "ReviewOnly") {
        $toMove = $results | Where-Object { $_.ConfidenceLevel -eq "Low" -or $_.Folder -eq "UNCLASSIFIED" }
        Write-Host ""
        Write-Warn "REVIEW ONLY - $($toMove.Count) low-confidence / unclassified emails in report."
        Write-Warn "Review and manually classify these emails."
        return
    }

    # Execute mode
    Write-Host ""
    Write-Status "EXECUTING - Moving emails to folders..."

    $highConf = $results | Where-Object { $_.ConfidenceLevel -in @("High", "Thread") -and $_.Folder -ne "UNCLASSIFIED" }
    $medConf = $results | Where-Object { $_.ConfidenceLevel -eq "Medium" -and $_.Folder -ne "UNCLASSIFIED" }
    $lowConf = $results | Where-Object { $_.ConfidenceLevel -eq "Low" -or $_.Folder -eq "UNCLASSIFIED" }

    Write-Status "Moving $($highConf.Count) high-confidence emails..."
    $moved = 0; $failed = 0

    foreach ($email in $highConf) {
        $targetFolder = $email.Folder
        if ($email.Subfolder) {
            $folderKey = "$targetFolder/$($email.Subfolder)"
        } else {
            $folderKey = $targetFolder
        }

        $folderId = $folderMap.$folderKey
        if (-not $folderId) {
            # Try parent folder if subfolder not found
            $folderId = $folderMap.$targetFolder
        }

        if ($folderId) {
            $success = Move-EmailToFolder -MessageId $email.MessageId -DestinationFolderId $folderId
            if ($success) { $moved++ } else { $failed++ }
        }
        else {
            Write-Warn "No folder ID found for: $folderKey"
            $failed++
        }

        # Rate limiting
        if ($moved % 50 -eq 0 -and $moved -gt 0) {
            Write-Detail "Moved $moved emails..."
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Success "High-confidence: $moved moved, $failed failed"

    Write-Host ""
    Write-Status "Moving $($medConf.Count) medium-confidence emails (flagged for review)..."
    $movedMed = 0

    foreach ($email in $medConf) {
        $folderId = $folderMap.($email.Folder)
        if ($folderId) {
            $success = Move-EmailToFolder -MessageId $email.MessageId -DestinationFolderId $folderId
            if ($success) { $movedMed++ }
        }
        if ($movedMed % 50 -eq 0 -and $movedMed -gt 0) {
            Start-Sleep -Milliseconds 200
        }
    }
    Write-Success "Medium-confidence: $movedMed moved (review recommended)"

    Write-Host ""
    Write-Warn "$($lowConf.Count) low-confidence / unclassified emails left in inbox for manual review."

    # ── Final summary ──
    Write-Host ""
    Write-Host "+" -NoNewline -ForegroundColor Green
    Write-Host ("=" * 60) -NoNewline -ForegroundColor Green
    Write-Host "+" -ForegroundColor Green
    Write-Host "|  CATALOGING COMPLETE" -ForegroundColor Green
    Write-Host "|  High confidence moved:   $moved" -ForegroundColor Green
    Write-Host "|  Medium confidence moved:  $movedMed" -ForegroundColor Green
    Write-Host "|  Left for manual review:   $($lowConf.Count)" -ForegroundColor Green
    Write-Host "|  Report: $ReportPath" -ForegroundColor Green
    Write-Host "+" -NoNewline -ForegroundColor Green
    Write-Host ("=" * 60) -NoNewline -ForegroundColor Green
    Write-Host "+" -ForegroundColor Green
    Write-Host ""
}

# Run
Main
