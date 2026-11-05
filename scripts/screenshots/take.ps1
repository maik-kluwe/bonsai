# Retakes the README images in images/: graph.png, changes.png, merge.png.
# Builds the demo repo (new-repo.ps1), starts a separate VS Code with a clean profile and the extension from build/,
# drives the window with mouse and keyboard and photographs it. Do not use the mouse or keyboard meanwhile.
# Needs: make build has run (build/bonsai-*.vsix). Usage: powershell -ExecutionPolicy Bypass -File scripts/screenshots/take.ps1
param([string[]]$Only = @('graph', 'changes', 'merge'), [switch]$Keep)   # -Keep leaves the window open at the end (for trying things out)

$Only = $Only | ForEach-Object { $_ -split ',' }   # powershell -File passes graph,changes as one string
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
$images = Join-Path $root 'images'
$repo = "$env:TEMP\bonsai-shots"
$profileDir = "$env:TEMP\bonsai-shots-vscode"
. "$PSScriptRoot\lib.ps1"

$vsix = Get-ChildItem "$root\build\*.vsix" | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $vsix) { throw 'No build/*.vsix found, run make build first' }

function Stop-ShotsCode {
  Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*bonsai-shots-vscode*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# Starts VS Code with an empty profile (only Bonsai installed), sizes the window to 1440 x 898 and opens Bonsai
function Start-ShotsCode {
  Stop-ShotsCode
  Remove-Item "$profileDir\data" -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force "$profileDir\data\User" | Out-Null
  @'
{
  "workbench.startupEditor": "none",
  "workbench.layoutControl.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "security.workspace.trust.enabled": false,
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
  "window.commandCenter": false,
  "workbench.tips.enabled": false,
  "chat.disableAIFeatures": true,
  "workbench.enableExperiments": false,
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "git.openRepositoryInParentFolders": "never"
}
'@ | Set-Content "$profileDir\data\User\settings.json" -Encoding utf8
  if (-not (Test-Path "$profileDir\ext")) {
    code --user-data-dir "$profileDir\data" --extensions-dir "$profileDir\ext" --install-extension $vsix.FullName 2>&1 | Out-Null
  }
  Start-Process code -ArgumentList @('-n', '--user-data-dir', "$profileDir\data", '--extensions-dir', "$profileDir\ext", $repo) -WindowStyle Hidden
  Wait-Window
  Set-Frame 200 100 1440 898
  Start-Sleep -Seconds 12   # the extension host and Git detection need time, otherwise the command goes nowhere
  Run-Command 'Bonsai: Open Bonsai'
  Start-Sleep -Seconds 4
  Focus-Window
  [System.Windows.Forms.SendKeys]::SendWait('^b')   # hide the Explorer so that Bonsai sits right next to the Activity Bar
  Start-Sleep -Seconds 2
}

# Take the focus out of the webview (the selection turns grey instead of blue) and the mouse out of the window
function Settle { Click-At 900 47; Move-Away }

# The repo is always rebuilt: without -Conflict for graph/changes, with -Conflict for merge
if ($Only -contains 'graph' -or $Only -contains 'changes') {
  & "$PSScriptRoot\new-repo.ps1" -Path $repo | Out-Null
  Start-ShotsCode

  if ($Only -contains 'graph') {
    Click-At 140 162          # Commits
    Click-At 800 269          # "Add a QR code to the share dialog"
    Click-At 700 690          # expand share.ts in the details
    Settle
    Save-Shot "$images\graph.png"
  }

  if ($Only -contains 'changes') {
    Click-At 130 133          # Local Changes
    Click-At 330 186          # map.ts
    Settle
    Save-Shot "$images\changes.png"
  }
}

if ($Only -contains 'merge') {
  & "$PSScriptRoot\new-repo.ps1" -Path $repo -Conflict | Out-Null
  Start-ShotsCode
  Click-At 1339 127         # Resolve in the banner: switches to Local Changes and shows the conflict card
  Click-At 1048 342         # Merge: opens the merge dialog
  Click-At 110 255          # take the left side of the first conflict
  Move-Away
  Save-Shot "$images\merge.png"
}

if (-not $Keep) { Stop-ShotsCode }
