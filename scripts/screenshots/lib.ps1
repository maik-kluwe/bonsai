# Helpers for take.ps1: find, position and operate a VS Code window and photograph it.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  public static IntPtr Find(uint[] pids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) >= 0 && sb.ToString().EndsWith("Visual Studio Code")) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
[Win]::SetProcessDPIAware() | Out-Null

$script:hwnd = [IntPtr]::Zero

# Only looks at windows of the isolated instance (profile folder bonsai-shots-vscode), never at the user's own VS Code
function Wait-Window([int]$seconds = 60) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    $pids = [uint32[]]@(Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*bonsai-shots-vscode*' } | ForEach-Object { $_.ProcessId })
    $h = [Win]::Find($pids)
    if ($h -ne [IntPtr]::Zero) { $script:hwnd = $h; return }
    Start-Sleep -Milliseconds 500
  }
  throw 'The Bonsai screenshot window did not appear'
}

# Visible frame of the window without the invisible shadow border (DWMWA_EXTENDED_FRAME_BOUNDS = 9)
function Get-Frame {
  $r = New-Object Win+RECT
  [Win]::DwmGetWindowAttribute($script:hwnd, 9, [ref]$r, [Runtime.InteropServices.Marshal]::SizeOf($r)) | Out-Null
  $r
}

# Sizes the window so that its visible frame is exactly $w x $h
function Set-Frame([int]$x, [int]$y, [int]$w, [int]$h) {
  [Win]::ShowWindow($script:hwnd, 9) | Out-Null
  [Win]::MoveWindow($script:hwnd, $x, $y, $w, $h, $true) | Out-Null
  Start-Sleep -Milliseconds 300
  $f = Get-Frame
  # Make up the difference between the wanted and the actual frame
  [Win]::MoveWindow($script:hwnd, $x - ($f.L - $x), $y - ($f.T - $y), $w + ($w - ($f.R - $f.L)), $h + ($h - ($f.B - $f.T)), $true) | Out-Null
  Start-Sleep -Milliseconds 500
}

function Focus-Window { [Win]::SetForegroundWindow($script:hwnd) | Out-Null; Start-Sleep -Milliseconds 300 }

# Click at a position relative to the top left corner of the window (pixels as in the screenshot)
function Click-At([int]$x, [int]$y, [switch]$Double) {
  $f = Get-Frame
  [Win]::SetCursorPos($f.L + $x, $f.T + $y) | Out-Null
  Start-Sleep -Milliseconds 150
  foreach ($n in 1..$(if ($Double) { 2 } else { 1 })) {
    [Win]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero); [Win]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
  }
  Start-Sleep -Milliseconds 600
}

function Move-Away { $f = Get-Frame; [Win]::SetCursorPos($f.R + 40, $f.T + 40) | Out-Null; Start-Sleep -Milliseconds 400 }

function Run-Command([string]$text) {
  Focus-Window
  [System.Windows.Forms.SendKeys]::SendWait('^+p')
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait($text)
  Start-Sleep -Milliseconds 700
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Seconds 2
}

function Save-Shot([string]$file) {
  $f = Get-Frame
  $w = $f.R - $f.L; $h = $f.B - $f.T
  $bmp = New-Object Drawing.Bitmap $w, $h
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($f.L, $f.T, 0, 0, (New-Object Drawing.Size $w, $h))
  $g.Dispose()
  $bmp.Save($file, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Saved $file ($w x $h)"
}
