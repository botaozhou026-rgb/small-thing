param(
    [string]$ShortcutDirectory = [Environment]::GetFolderPath('DesktopDirectory'),
    [string]$ExecutablePath = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = if ($ExecutablePath) { [IO.Path]::GetFullPath($ExecutablePath) } else {
    Join-Path $projectRoot 'release\ZRead-win32-x64\ZRead.exe'
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'Please run npm run pack before creating the desktop shortcut.'
}
if (-not (Test-Path -LiteralPath $ShortcutDirectory -PathType Container)) {
    throw 'The desktop or shortcut directory does not exist.'
}
$shortcutPath = Join-Path $ShortcutDirectory 'ZRead.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = Split-Path -Parent $executable
$shortcut.IconLocation = "$executable,0"
$shortcut.Description = 'ZRead - TXT Reader'
$shortcut.WindowStyle = 1
$shortcut.Save()
# Refresh only this executable and shortcut after replacing a packaged icon.
if (-not ('ZReadShellNotify' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ZReadShellNotify {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(uint change, uint flags, string path, IntPtr unused);
}
'@
}
[ZReadShellNotify]::SHChangeNotify(0x2000, 0x0005, $executable, [IntPtr]::Zero)
[ZReadShellNotify]::SHChangeNotify(0x2000, 0x0005, $shortcutPath, [IntPtr]::Zero)
Write-Output "Created shortcut: $shortcutPath"
