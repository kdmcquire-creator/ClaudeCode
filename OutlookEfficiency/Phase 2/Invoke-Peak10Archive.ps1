<#
.SYNOPSIS
    Peak 10 Energy - Quarterly Archive Script
    Moves emails older than the configured threshold from working folders to Archive mirrors.

.DESCRIPTION
    Scans ALL functional folders 01-11 AND their subfolders for emails older than
    $DaysThreshold days. Preserves emails in active conversation threads (i.e. the thread
    has seen activity within $ActiveThreadDays days). Moves qualifying emails to the
    matching Archive path (e.g. "01 - Operations/HSE" → "Archive/01 - Operations/HSE").

    Specific subfolders — "Active Deals" and "Litigation - Disputes" — are never archived
    because the emails there are always operationally live.

.USAGE
    .\Invoke-Peak10Archive.ps1 -Mode Preview          # Dry run — classifies, moves nothing
    .\Invoke-Peak10Archive.ps1 -Mode Execute           # Moves emails
    .\Invoke-Peak10Archive.ps1 -Mode Execute -DaysThreshold 120   # Custom age

.NOTES
    Author: Claude (Anthropic) for Peak 10 Energy
    Version: 1.1 | February 2026
#>

#Requires -Version 7.0

param(
    [ValidateSet("Preview", "Execute")]
    [string]$Mode = "Preview",

    [int]$DaysThreshold = 90,

    [int]$ActiveThreadDays = 30,

    [string]$FolderMapPath = ".\Peak10_FolderMap.json",

    [string]$ReportPath = ".\ArchiveReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"
)

$ErrorActionPreference = "Stop"

function Write-Status($msg)  { Write-Host "  [*] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "  [+] $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)    { Write-Host "  [-] $msg" -ForegroundColor Red }
function Write-Detail($msg)  { Write-Host "      $msg" -ForegroundColor DarkGray }

# Subfolders that must never be archived (exact display-name match)
$ExcludedSubfolders = @(
    "Active Deals",
    "Litigation - Disputes"
)

# ══════════════════════════════════════════════════════════════
# HELPER: Scan one folder (or subfolder) and archive qualifying emails
# ══════════════════════════════════════════════════════════════

function Invoke-FolderArchive {
    <#
    .SYNOPSIS
        Scans a single mail folder, identifies emails older than the cutoff that belong
        to inactive threads, and moves them to the corresponding Archive folder.
        Returns the count of emails eligible for archiving.
    #>
    param(
        [string]$FolderId,
        [string]$FolderDisplayName,
        [string]$ArchiveFolderKey,      # Key into $FolderMap hashtable, e.g. "Archive/01 - Operations/HSE"
        $FolderMap,                     # Hashtable of folderName → Graph folder ID
        [string]$CutoffDate,            # ISO 8601 — emails before this date are candidates
        [string]$ActiveDate,            # ISO 8601 — threads with activity after this are kept
        [string]$RunMode,
        [System.Collections.Generic.List[object]]$ResultsRef
    )

    # Resolve the destination archive folder ID
    $archiveFolderId = $FolderMap[$ArchiveFolderKey]
    if (-not $archiveFolderId) {
        Write-Warn "    No archive destination mapped for key: '$ArchiveFolderKey' — skipping"
        return 0
    }

    # ── Fetch old messages (URL-encode the OData filter) ──────────────────────────
    $rawFilter = "receivedDateTime lt $CutoffDate"
    $encFilter = [uri]::EscapeDataString($rawFilter)
    $uri = "https://graph.microsoft.com/v1.0/me/mailFolders/$FolderId/messages" +
           "?`$filter=$encFilter&`$select=id,subject,receivedDateTime,conversationId&`$top=100"

    $oldMessages = [System.Collections.Generic.List[object]]::new()
    try {
        do {
            $response = Invoke-MgGraphRequest -Method GET -Uri $uri
            foreach ($m in $response.value) { $oldMessages.Add($m) }
            $uri = $response.'@odata.nextLink'
            Start-Sleep -Milliseconds 100
        } while ($uri)
    }
    catch {
        Write-Fail "    Error fetching messages from '$FolderDisplayName': $($_.Exception.Message)"
        return 0
    }

    if ($oldMessages.Count -eq 0) {
        Write-Detail "    No emails older than threshold in '$FolderDisplayName'"
        return 0
    }

    Write-Detail "    $($oldMessages.Count) emails older than $DaysThreshold days in '$FolderDisplayName'"

    # ── Filter out active threads ──────────────────────────────────────────────────
    $toArchive = [System.Collections.Generic.List[object]]::new()
    foreach ($msg in $oldMessages) {
        # Conversation ID may contain characters that need URL-encoding
        $rawConvFilter = "conversationId eq '$($msg.conversationId)' and receivedDateTime gt $ActiveDate"
        $encConvFilter = [uri]::EscapeDataString($rawConvFilter)
        try {
            $recentCheck = Invoke-MgGraphRequest -Method GET `
                -Uri ("https://graph.microsoft.com/v1.0/me/messages" +
                      "?`$filter=$encConvFilter&`$select=id&`$top=1")
            if ($recentCheck.value.Count -eq 0) {
                $toArchive.Add($msg)   # no recent activity → safe to archive
            }
        }
        catch {
            Write-Detail "    Could not verify thread for '$($msg.subject)' — skipping to be safe"
        }
        Start-Sleep -Milliseconds 50
    }

    Write-Detail "    After excluding active threads: $($toArchive.Count) eligible"

    # ── Move (or report in Preview) ────────────────────────────────────────────────
    $movedCount = 0; $failedCount = 0
    foreach ($msg in $toArchive) {
        $status = "Preview"

        if ($RunMode -eq "Execute") {
            try {
                $body = @{ destinationId = $archiveFolderId } | ConvertTo-Json
                Invoke-MgGraphRequest -Method POST `
                    -Uri "https://graph.microsoft.com/v1.0/me/messages/$($msg.id)/move" `
                    -Body $body -ContentType "application/json" | Out-Null
                $movedCount++
                $status = "Archived"
                if ($movedCount % 50 -eq 0) { Start-Sleep -Milliseconds 300 }
            }
            catch {
                $failedCount++
                $status = "Failed"
                Write-Fail "    Failed to archive: '$($msg.subject)'"
            }
        }

        $ResultsRef.Add([PSCustomObject]@{
            Subject       = $msg.subject
            ReceivedDate  = $msg.receivedDateTime
            SourceFolder  = $FolderDisplayName
            ArchiveFolder = $ArchiveFolderKey
            MessageId     = $msg.id
            Status        = $status
        })
    }

    if ($RunMode -eq "Execute" -and $toArchive.Count -gt 0) {
        Write-Success "    Archived $movedCount of $($toArchive.Count) ($failedCount failed)"
    }

    return $toArchive.Count
}

# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

function Main {
    Write-Host ""
    Write-Host "  PEAK 10 ENERGY - Quarterly Archive" -ForegroundColor Cyan
    Write-Host "  Mode: $Mode | Age threshold: $DaysThreshold days | Active-thread window: $ActiveThreadDays days" -ForegroundColor Cyan
    Write-Host ""

    # ── Load folder map ──────────────────────────────────────────────────────────
    if (-not (Test-Path $FolderMapPath)) {
        Write-Fail "Folder map not found at: $FolderMapPath"
        Write-Fail "Run Create-Peak10FolderStructure_v1.1.ps1 first to generate it."
        return
    }

    $folderMapObj = (Get-Content $FolderMapPath -Raw | ConvertFrom-Json).Folders

    # Convert PSCustomObject → plain hashtable so we can do $map[$key] lookups
    $folderMap = @{}
    foreach ($prop in $folderMapObj.PSObject.Properties) {
        $folderMap[$prop.Name] = $prop.Value
    }
    Write-Success "Folder map loaded ($($folderMap.Count) entries)."

    # ── Connect ──────────────────────────────────────────────────────────────────
    Connect-MgGraph -Scopes "Mail.ReadWrite" -NoWelcome
    Write-Success "Connected to Microsoft Graph."

    $cutoffDate = (Get-Date).AddDays(-$DaysThreshold).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $activeDate  = (Get-Date).AddDays(-$ActiveThreadDays).ToString("yyyy-MM-ddTHH:mm:ssZ")

    Write-Status "Archive cutoff   : emails received before $cutoffDate"
    Write-Status "Active-thread bar: threads with activity after $activeDate are preserved"
    Write-Host ""

    # ── Locate functional folders and the Archive root ───────────────────────────
    $allMailFolders    = Get-MgUserMailFolder -UserId "me" -All
    $functionalFolders = $allMailFolders | Where-Object { $_.DisplayName -match "^\d{2} - " }
    $archiveRoot       = $allMailFolders | Where-Object { $_.DisplayName -eq "Archive" } | Select-Object -First 1

    if (-not $archiveRoot) {
        Write-Fail "Archive root folder not found. Run the folder creation script first."
        return
    }
    if (-not $functionalFolders) {
        Write-Fail "No functional folders (01 - ... through 11 - ...) found. Verify the folder structure."
        return
    }

    $results       = [System.Collections.Generic.List[object]]::new()
    $totalEligible = 0

    # ── Process each functional folder AND its subfolders ────────────────────────
    foreach ($folder in $functionalFolders) {
        Write-Status "Scanning: $($folder.DisplayName)..."

        # Top-level functional folder
        $topKey    = $folder.DisplayName
        $archTopKey = "Archive/$topKey"
        $totalEligible += Invoke-FolderArchive `
            -FolderId          $folder.Id `
            -FolderDisplayName $topKey `
            -ArchiveFolderKey  $archTopKey `
            -FolderMap         $folderMap `
            -CutoffDate        $cutoffDate `
            -ActiveDate        $activeDate `
            -RunMode           $Mode `
            -ResultsRef        $results

        # Subfolders
        try {
            $subfolders = Get-MgUserMailFolderChildFolder -UserId "me" -MailFolderId $folder.Id -All
            foreach ($sub in $subfolders) {

                # Certain subfolders are operationally live and must not be archived
                if ($ExcludedSubfolders -contains $sub.DisplayName) {
                    Write-Warn "    Skipping excluded subfolder: $($sub.DisplayName)"
                    continue
                }

                $subKey     = "$topKey/$($sub.DisplayName)"
                $archSubKey = "Archive/$subKey"

                Write-Detail "    Subfolder: $($sub.DisplayName)"
                $totalEligible += Invoke-FolderArchive `
                    -FolderId          $sub.Id `
                    -FolderDisplayName $subKey `
                    -ArchiveFolderKey  $archSubKey `
                    -FolderMap         $folderMap `
                    -CutoffDate        $cutoffDate `
                    -ActiveDate        $activeDate `
                    -RunMode           $Mode `
                    -ResultsRef        $results
            }
        }
        catch {
            Write-Detail "    Could not retrieve subfolders for $($folder.DisplayName) (may have none)"
        }
    }

    # ── Export report ─────────────────────────────────────────────────────────────
    if ($results.Count -gt 0) {
        $results | Export-Csv -Path $ReportPath -NoTypeInformation -Encoding UTF8
        Write-Success "Report saved to: $ReportPath"
    }
    else {
        Write-Warn "No emails qualified for archiving — no report generated."
    }

    # ── Summary ──────────────────────────────────────────────────────────────────
    Write-Host ""
    Write-Host "  ARCHIVE SUMMARY" -ForegroundColor Green
    Write-Host "  Emails eligible to archive : $totalEligible" -ForegroundColor White

    if ($Mode -eq "Preview") {
        Write-Warn "  PREVIEW MODE — no emails were moved."
        Write-Warn "  Review the report in Excel, then run with -Mode Execute to proceed."
    }
    else {
        $movedTotal  = ($results | Where-Object { $_.Status -eq "Archived" }).Count
        $failedTotal = ($results | Where-Object { $_.Status -eq "Failed"   }).Count
        Write-Success "  Moved : $movedTotal"
        if ($failedTotal -gt 0) {
            Write-Warn  "  Failed: $failedTotal (see report for details)"
        }
    }
    Write-Host ""
}

Main
