# Reloads every open VS Code window through the Command Palette, so a freshly installed extension is picked up.
# Run: powershell -File scripts/reload-vscode.ps1
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@

$windows = Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $windows) {
  Write-Host 'No VS Code window is open.'
  exit 1
}

foreach ($w in $windows) {
  Write-Host "Reloading: $($w.MainWindowTitle)"
  [Win]::ShowWindow($w.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
  [Win]::SetForegroundWindow($w.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait('^+p')
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait('Developer: Reload Window')
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Seconds 2
}
