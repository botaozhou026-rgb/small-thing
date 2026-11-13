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
Write-Output "Created shortcut: $shortcutPath"
