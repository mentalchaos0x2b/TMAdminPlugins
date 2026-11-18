$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$outPath = Join-Path (Get-Location) 'docs/screens/step12-network.png'
$port = 1432

Write-Host "Starting Vite dev server on port $port..."
$vite = Start-Process -FilePath 'npx.cmd' -ArgumentList 'vite', '--port', "$port", '--strictPort' -PassThru

try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/plugins/system/network/demo/index.html" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
      if ($resp.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      # retry
    }
  }

  if (-not $ready) {
    throw "Vite dev server did not respond at http://127.0.0.1:$port/plugins/system/network/demo/index.html"
  }

  Write-Host "Vite dev server is ready. Waiting for modules to bundle and compile..."
  Start-Sleep -Seconds 4

  Write-Host "Taking screenshot with Edge headless..."
  & $edge --headless --disable-gpu --hide-scrollbars --window-size=1440,900 "--screenshot=$outPath" "http://127.0.0.1:$port/plugins/system/network/demo/index.html"

  Start-Sleep -Seconds 2
  if (Test-Path $outPath) {
    $item = Get-Item $outPath
    Write-Host "Screenshot created successfully: $outPath ($($item.Length) bytes)"
  } else {
    throw "Screenshot file was not generated at $outPath"
  }
} finally {
  Write-Host "Stopping Vite..."
  Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
}
