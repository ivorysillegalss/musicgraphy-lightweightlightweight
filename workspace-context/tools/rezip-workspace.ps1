# Rebuild the FULL WORKSPACE archive zip (Musicgraphy 2.0).
# ASCII-only on purpose: Chinese paths inside a PS1 read under ANSI/GBK codepage break.
# Entry names are derived from the filesystem at runtime, so non-ASCII names are
# written as proper UTF-8 by .NET ZipArchive. Do NOT rebuild with tar.exe/bsdtar
# (GBK entry names + garbled -f output filename + .zcode leak, proven 2026-11-12/13).
# Exclusions: session/deploy state (.zcode, .zcode-site), node_modules, extracted
# portable Node dir (the .zip is kept), root-level *.zip (no nested archives).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\rezip-workspace.ps1

$ErrorActionPreference = 'Stop'
$ws = 'C:\Users\Administrator\.zcode\workspace\draft-8e6cfbb0-0eb1-401d-b0b0-e96203f0ba8a'
$dstName = 'Musicgraphy-2.0-workspace-archive-20261113.zip'
$dst = Join-Path $ws $dstName
$tmp = Join-Path $env:TEMP 'MG-workspace-archive.zip.new'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $tmp) { Remove-Item $tmp -Force }
# NOTE: the workspace lives under C:\Users\<user>\.zcode\, so a generic '\.zcode\'
# substring/regex filter would exclude EVERYTHING. Exclusions are decided on
# PATH SEGMENTS of the workspace-relative path instead.
function Test-Excluded([string]$relPath, [string]$extension) {
  $segs = $relPath -split '\\'
  if ($segs -contains '.zcode') { return $true }        # session state anywhere below ws
  if ($segs -contains '.zcode-site') { return $true }   # deploy staging
  if ($segs -contains 'node_modules') { return $true }  # restorable via npm install
  if (($segs[0] -eq 'tools') -and ($segs[1] -eq 'node-v26.13.0-win-x64')) { return $true } # extracted portable dir (zip is kept)
  if (($segs.Count -eq 1) -and ($extension -eq '.zip')) { return $true }  # root-level archives (no nesting)
  return $false
}
$archive = [System.IO.Compression.ZipFile]::Open($tmp, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files = Get-ChildItem -LiteralPath $ws -Recurse -File -Force | Where-Object {
    -not (Test-Excluded $_.FullName.Substring($ws.Length + 1) $_.Extension)
  }
  $skipped = New-Object System.Collections.Generic.List[string]
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($ws.Length + 1).Replace('\', '/')
    # Shared read: tolerate files held open by other processes (e.g. a live
    # SQLite db from a dev server). On hard lock failure, skip and report.
    $fs = $null
    try {
      $fs = [System.IO.File]::Open($f.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    } catch {
      $skipped.Add($rel)
      continue
    }
    try {
      $e = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
      $es = $e.Open()
      try { $fs.CopyTo($es) } finally { $es.Dispose() }
    } catch {
      $skipped.Add($rel)
    } finally {
      if ($fs) { $fs.Dispose() }
    }
  }
} finally { $archive.Dispose() }

Move-Item $tmp $dst -Force

# Read-back verification (ASCII-only output; count matches instead of printing CJK names)
  $check = [System.IO.Compression.ZipFile]::OpenRead($dst)
try {
  $names = $check.Entries | ForEach-Object { $_.FullName }
  Write-Output ("entries=" + $names.Count)
  # leaks: session/deploy state or node_modules anywhere below the workspace root.
  # The portable tools zip (tools/node-v26.13.0-win-x64.zip) is intentional and excluded from this check.
  $leak = ($names | Where-Object { $_ -like '*node_modules*' -or $_ -match '(^|/)\.zcode(-site)?/' -or $_ -like '*tools/node-v26.13.0-win-x64/*' }).Count
  Write-Output ("leaks=" + $leak)
  Write-Output ("root-agents-md=" + ($names | Where-Object { $_ -eq 'AGENTS.md' }).Count)
  Write-Output ("tools-zip=" + ($names | Where-Object { $_ -eq 'tools/node-v26.13.0-win-x64.zip' }).Count)
  Write-Output ("docpkg-files=" + ($names | Where-Object { $_ -like 'Musicgraphy-2.0-*/00-*.md' }).Count)
  Write-Output ("mainline-src=" + ($names | Where-Object { $_ -like 'musicgraphy/src/*' }).Count)
  Write-Output ("legacy-src=" + ($names | Where-Object { $_ -like 'Musicgraphy-2.0-*/src/*' }).Count)
  Write-Output ("nested-zip=" + ($names | Where-Object { $_ -like '*.zip' }).Count)
  Write-Output ("download-skill=" + ($names | Where-Object { $_ -like '_downloads/*' }).Count)
} finally { $check.Dispose() }
Write-Output ("size-bytes=" + (Get-Item -LiteralPath $dst).Length)
