$ws = Split-Path -Parent (Split-Path -Parent $PSCommandPath)  # 工作区根 = tools/ 的上级（2026-11-14 归档工作区适配：不再硬编码机器路径）
$src = Join-Path $ws 'Musicgraphy-2.0-文档包'
$dst = Join-Path $ws 'Musicgraphy-2.0-文档包.zip'
$tmp = Join-Path $env:TEMP 'Musicgraphy-2.0-文档包.zip.new'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $tmp) { Remove-Item $tmp -Force }
$archive = [System.IO.Compression.ZipFile]::Open($tmp, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $prefix = 'Musicgraphy-2.0-文档包/'
  # 顶层目录条目
  [void]$archive.CreateEntry($prefix)
  $files = Get-ChildItem -LiteralPath $src -Recurse -File | Where-Object {
    $_.FullName -notmatch [regex]::Escape((Join-Path $src '.zcode'))
  }
  foreach ($f in $files) {
    $rel = $prefix + $f.FullName.Substring($src.Length + 1).Replace('\', '/')
    $e = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $fs = [System.IO.File]::OpenRead($f.FullName)
    try {
      $es = $e.Open()
      try { $fs.CopyTo($es) } finally { $es.Dispose() }
    } finally { $fs.Dispose() }
  }
} finally { $archive.Dispose() }

Move-Item $tmp $dst -Force

# 回读验证：条目数、UTF-8 命名、08 看板四件、无 .zcode
$check = [System.IO.Compression.ZipFile]::OpenRead($dst)
try {
  $names = $check.Entries | ForEach-Object { $_.FullName }
  Write-Output ("entries=" + $names.Count)
  Write-Output ("zcode-leak=" + ($names | Where-Object { $_ -like '*\.zcode\*' -or $_ -like '*/.zcode/*' }).Count)
  $names | Where-Object { $_ -match '08-进度看板/' } | ForEach-Object { Write-Output $_ }
  Write-Output ("sample: " + ($names | Where-Object { $_ -match '00-文件目录' }))
} finally { $check.Dispose() }
