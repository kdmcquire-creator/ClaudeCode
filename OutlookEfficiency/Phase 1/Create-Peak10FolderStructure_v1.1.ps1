<#
.SYNOPSIS
    Peak 10 Energy - Outlook Folder Structure Creation Script
    
.DESCRIPTION
    Creates the complete folder hierarchy for Peak 10 Energy's Outlook organization
    project across the Peak 10 work account and personal Gmail accounts.
    Uses Microsoft Graph API via the Microsoft Graph PowerShell SDK.
    
.PREREQUISITES
    1. PowerShell 7.0 or later
    2. Microsoft Graph PowerShell SDK: Install-Module Microsoft.Graph -Scope CurrentUser
    3. Azure AD App Registration with the following permissions:
       - Mail.ReadWrite (Delegated)
       - MailboxSettings.ReadWrite (Delegated)
    4. Sign in with the target user's credentials (or admin credentials with impersonation)
    
.USAGE
    1. Open PowerShell 7
    2. Run: .\Create-Peak10FolderStructure.ps1
    3. Authenticate when prompted
    4. Select which account(s) to configure
    
.NOTES
    Author: Claude (Anthropic) for Peak 10 Energy
    Date: February 2026
    Version: 1.1
#>

#Requires -Version 7.0

# ══════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

# Color output helpers
function Write-Status($msg) { Write-Host "  [*] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "  [✓] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  [✗] $msg" -ForegroundColor Red }

# ══════════════════════════════════════════════════════════════
# FOLDER DEFINITIONS
# ══════════════════════════════════════════════════════════════

# Peak 10 Energy Account - Action State Folders
$Peak10ActionFolders = @(
    "⚠ ACTION REQUIRED",
    "⏳ WAITING ON REPLY",
    "📋 REVIEW - READ",
    "📅 MEETING PREP"
)

# Peak 10 Energy Account - Functional Folders with Subfolders
$Peak10FunctionalFolders = @{
    "01 - Operations" = @(
        "HSE",
        "Production Reports",
        "Facilities & Equipment"
    )
    "02 - Land & Title" = @(
        "Title Opinions",
        "Division Orders",
        "Curative",
        "DOTO"
    )
    "03 - Engineering & Geology" = @(
        "AFEs",
        "Well Plans",
        "Geology - Maps"
    )
    "04 - Business Development & Deals" = @(
        "Active Deals",
        "Dead Deals",
        "Deal Flow - Screening",
        "Brokers & Sources"
    )
    "05 - Investors & Capital" = @(
        "Investor Relations",
        "Banking & Lending",
        "Board - Advisory",
        "Capital Raises"
    )
    "06 - JV & Partners" = @(
        "JOA Administration",
        "Elections & Consents"
    )
    "07 - Legal" = @(
        "Contracts",
        "Litigation - Disputes",
        "Corporate - Governance",
        "Entity Management"
    )
    "08 - Regulatory & Compliance" = @(
        "RRC - State Agencies",
        "Environmental",
        "Permits & Bonds"
    )
    "09 - Finance & Accounting" = @(
        "JIB + Invoices",
        "Revenue + AP",
        "Accounting",
        "Tax",
        "Insurance",
        "Audit"
    )
    "10 - People & Admin" = @(
        "HR - Team",
        "IT - Systems",
        "Vendors & Services",
        "Office - Admin"
    )
    "11 - Industry & External" = @(
        "Associations & Memberships",
        "Conferences & Events",
        "Market Intelligence"
    )
}

# Personal Account Folders (same for both utexas.edu and kdmcquire@gmail.com)
$PersonalFolders = @{
    "Financial - Banking" = @()
    "Property - Real Estate" = @()
    "Education - Alumni" = @()
    "Health & Wellness" = @()
    "Travel" = @()
    "Subscriptions & Services" = @()
    "Family & Personal" = @()
    "Professional - Networking" = @()
    "Archive" = @(
        "Financial - Banking",
        "Property - Real Estate",
        "Education - Alumni",
        "Health & Wellness",
        "Travel",
        "Subscriptions & Services",
        "Family & Personal",
        "Professional - Networking"
    )
}

# ══════════════════════════════════════════════════════════════
# FUNCTIONS
# ══════════════════════════════════════════════════════════════

function Connect-ToGraph {
    <#
    .SYNOPSIS
        Connects to Microsoft Graph with required permissions.
    #>
    Write-Status "Connecting to Microsoft Graph..."
    
    try {
        Connect-MgGraph -Scopes "Mail.ReadWrite", "MailboxSettings.ReadWrite" -NoWelcome
        $context = Get-MgContext
        Write-Success "Connected as: $($context.Account)"
        return $true
    }
    catch {
        Write-Fail "Failed to connect to Microsoft Graph: $($_.Exception.Message)"
        return $false
    }
}

function Get-ExistingFolders {
    <#
    .SYNOPSIS
        Retrieves all existing mail folders recursively (BFS) for the signed-in user.
        Uses a queue so every level of nesting is captured, preventing duplicate
        creation on re-runs (especially important for the Archive sub-hierarchy).
    #>
    param([string]$UserId = "me")

    Write-Status "Retrieving existing folder structure..."

    try {
        $allFolders = [System.Collections.Generic.List[object]]::new()
        $queue      = [System.Collections.Generic.Queue[object]]::new()

        # Seed with top-level folders
        $topFolders = Get-MgUserMailFolder -UserId $UserId -All -Property "Id,DisplayName,ParentFolderId,ChildFolderCount"
        foreach ($f in $topFolders) {
            $allFolders.Add($f)
            if ($f.ChildFolderCount -gt 0) { $queue.Enqueue($f) }
        }

        # BFS: process each folder that has children
        while ($queue.Count -gt 0) {
            $parent = $queue.Dequeue()
            try {
                $children = Get-MgUserMailFolderChildFolder -UserId $UserId -MailFolderId $parent.Id -All -Property "Id,DisplayName,ParentFolderId,ChildFolderCount"
                foreach ($child in $children) {
                    $allFolders.Add($child)
                    if ($child.ChildFolderCount -gt 0) { $queue.Enqueue($child) }
                }
            }
            catch {
                Write-Warn "Could not retrieve children for folder: $($parent.DisplayName)"
            }
            Start-Sleep -Milliseconds 100  # gentle rate limiting
        }

        Write-Success "Found $($allFolders.Count) existing folders"
        return $allFolders.ToArray()
    }
    catch {
        Write-Fail "Failed to retrieve folders: $($_.Exception.Message)"
        return @()
    }
}

function New-MailFolder {
    <#
    .SYNOPSIS
        Creates a mail folder, checking for existence first.
    #>
    param(
        [string]$DisplayName,
        [string]$ParentFolderId = $null,
        [string]$UserId = "me",
        [array]$ExistingFolders
    )
    
    # Check if folder already exists at this level
    $existing = $ExistingFolders | Where-Object {
        $_.DisplayName -eq $DisplayName -and
        ($null -eq $ParentFolderId -or $_.ParentFolderId -eq $ParentFolderId)
    }
    
    if ($existing) {
        Write-Warn "Folder already exists: $DisplayName (skipping)"
        return $existing | Select-Object -First 1
    }
    
    try {
        $params = @{ DisplayName = $DisplayName }
        
        if ($ParentFolderId) {
            $folder = New-MgUserMailFolderChildFolder -UserId $UserId -MailFolderId $ParentFolderId -BodyParameter $params
        }
        else {
            $folder = New-MgUserMailFolder -UserId $UserId -BodyParameter $params
        }
        
        Write-Success "Created: $DisplayName"
        return $folder
    }
    catch {
        Write-Fail "Failed to create folder '$DisplayName': $($_.Exception.Message)"
        return $null
    }
}

function New-FolderStructure {
    <#
    .SYNOPSIS
        Creates a complete folder structure from a hashtable definition.
    #>
    param(
        [hashtable]$Structure,
        [array]$TopLevelFolders = @(),
        [string]$ParentFolderId = $null,
        [string]$UserId = "me",
        [array]$ExistingFolders
    )
    
    $createdFolders = @{}
    
    # Create top-level folders first (action state folders, if any)
    foreach ($folderName in $TopLevelFolders) {
        $folder = New-MailFolder -DisplayName $folderName -ParentFolderId $ParentFolderId -UserId $UserId -ExistingFolders $ExistingFolders
        if ($folder) {
            $createdFolders[$folderName] = $folder.Id
        }
        Start-Sleep -Milliseconds 200  # Rate limiting
    }
    
    # Create functional folders with subfolders
    foreach ($folderName in ($Structure.Keys | Sort-Object)) {
        $folder = New-MailFolder -DisplayName $folderName -ParentFolderId $ParentFolderId -UserId $UserId -ExistingFolders $ExistingFolders
        
        if ($folder) {
            $createdFolders[$folderName] = $folder.Id
            
            # Create subfolders
            foreach ($subName in $Structure[$folderName]) {
                $sub = New-MailFolder -DisplayName $subName -ParentFolderId $folder.Id -UserId $UserId -ExistingFolders $ExistingFolders
                if ($sub) {
                    $createdFolders["$folderName/$subName"] = $sub.Id
                }
                Start-Sleep -Milliseconds 200
            }
        }
        Start-Sleep -Milliseconds 200
    }
    
    return $createdFolders
}

function Export-FolderMap {
    <#
    .SYNOPSIS
        Exports the created folder IDs to a JSON file for use by cataloging scripts.
    #>
    param(
        [hashtable]$FolderMap,
        [string]$AccountName,
        [string]$OutputPath
    )
    
    $export = @{
        Account = $AccountName
        CreatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        Folders = $FolderMap
    }
    
    $export | ConvertTo-Json -Depth 5 | Set-Content -Path $OutputPath -Encoding UTF8
    Write-Success "Folder map exported to: $OutputPath"
}

# ══════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ══════════════════════════════════════════════════════════════

function Main {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  PEAK 10 ENERGY - Outlook Folder Structure Creator      ║" -ForegroundColor Cyan
    Write-Host "║  Phase 1 Deployment Script                              ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    
    # Step 1: Connect
    if (-not (Connect-ToGraph)) {
        Write-Fail "Cannot proceed without Graph connection. Exiting."
        return
    }
    
    Write-Host ""
    Write-Host "Which account(s) do you want to configure?" -ForegroundColor White
    Write-Host "  1. Peak 10 Energy (work account)" -ForegroundColor White
    Write-Host "  2. Personal Gmail accounts" -ForegroundColor White
    Write-Host "  3. All accounts" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "Enter choice (1/2/3)"
    
    # Get existing folders
    $existingFolders = Get-ExistingFolders
    
    # ── PEAK 10 ACCOUNT ──
    if ($choice -in @("1", "3")) {
        Write-Host ""
        Write-Host "━━━ PEAK 10 ENERGY ACCOUNT ━━━" -ForegroundColor Cyan
        Write-Host ""
        
        # Create action-state folders
        Write-Status "Creating action-state folders..."
        $peak10Map = @{}
        foreach ($name in $Peak10ActionFolders) {
            $folder = New-MailFolder -DisplayName $name -UserId "me" -ExistingFolders $existingFolders
            if ($folder) { $peak10Map[$name] = $folder.Id }
            Start-Sleep -Milliseconds 200
        }
        
        # Create functional folders
        Write-Host ""
        Write-Status "Creating functional folders..."
        $functionalMap = New-FolderStructure -Structure $Peak10FunctionalFolders -UserId "me" -ExistingFolders $existingFolders
        $peak10Map += $functionalMap
        
        # Create Archive structure (mirror of functional folders)
        Write-Host ""
        Write-Status "Creating Archive mirror structure..."
        $archiveFolder = New-MailFolder -DisplayName "Archive" -UserId "me" -ExistingFolders $existingFolders
        if ($archiveFolder) {
            $peak10Map["Archive"] = $archiveFolder.Id
            $archiveMap = New-FolderStructure -Structure $Peak10FunctionalFolders -ParentFolderId $archiveFolder.Id -UserId "me" -ExistingFolders $existingFolders
            foreach ($key in $archiveMap.Keys) {
                $peak10Map["Archive/$key"] = $archiveMap[$key]
            }
        }
        
        # Export folder map
        Export-FolderMap -FolderMap $peak10Map -AccountName "Peak10Energy" -OutputPath ".\Peak10_FolderMap.json"
        
        Write-Host ""
        Write-Success "Peak 10 Energy folder structure complete!"
        Write-Success "Total folders created/verified: $($peak10Map.Count)"
    }
    
    # ── PERSONAL ACCOUNTS ──
    if ($choice -in @("2", "3")) {
        Write-Host ""
        Write-Host "━━━ PERSONAL ACCOUNTS ━━━" -ForegroundColor Cyan
        Write-Host ""
        Write-Warn "To configure personal Gmail accounts, you must sign in with each account."
        Write-Warn "The script will prompt you to re-authenticate for each account."
        
        foreach ($account in @("kmcquire@utexas.edu", "kdmcquire@gmail.com")) {
            Write-Host ""
            Write-Host "  Configuring: $account" -ForegroundColor Yellow
            $proceed = Read-Host "  Sign in to $account now? (y/n)"
            
            if ($proceed -eq "y") {
                Disconnect-MgGraph -ErrorAction SilentlyContinue
                Connect-MgGraph -Scopes "Mail.ReadWrite" -NoWelcome
                
                $existingPersonal = Get-ExistingFolders
                
                Write-Status "Creating folder structure for $account..."
                $personalMap = New-FolderStructure -Structure $PersonalFolders -UserId "me" -ExistingFolders $existingPersonal
                
                $safeName = $account -replace '[^a-zA-Z0-9]', '_'
                Export-FolderMap -FolderMap $personalMap -AccountName $account -OutputPath ".\${safeName}_FolderMap.json"
                
                Write-Success "$account folder structure complete!"
            }
            else {
                Write-Warn "Skipping $account"
            }
        }
    }
    
    # ── SUMMARY ──
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  FOLDER CREATION COMPLETE                               ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "  1. Verify folders appear correctly in Outlook (desktop & mobile)" -ForegroundColor White
    Write-Host "  2. Report any issues to Claude for adjustment" -ForegroundColor White
    Write-Host "  3. Once verified, Gate 2 is cleared for cataloging scripts" -ForegroundColor White
    Write-Host ""
    Write-Host "  Folder map JSON files saved in current directory." -ForegroundColor Gray
    Write-Host "  These files are required by the Phase 2 cataloging scripts." -ForegroundColor Gray
    Write-Host ""
}

# Run
Main
