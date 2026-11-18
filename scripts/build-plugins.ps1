[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}

$RepoRoot = (Resolve-Path $RepoRoot).Path
$sourcesDir = Join-Path $RepoRoot "sources"
$pluginsDir = Join-Path $RepoRoot "plugins"
$indexJsonPath = Join-Path $RepoRoot "index.json"

Write-Host "Building plugins from: $sourcesDir" -ForegroundColor Cyan
Write-Host "Output plugins dir: $pluginsDir" -ForegroundColor Cyan

if (-not (Test-Path $sourcesDir)) {
    Write-Error "Sources directory not found: $sourcesDir"
    exit 1
}

if (-not (Test-Path $pluginsDir)) {
    New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
}

# Load or initialize index.json
$indexData = [ordered]@{}
if (Test-Path $indexJsonPath) {
    $indexContent = [System.IO.File]::ReadAllText($indexJsonPath, [System.Text.UTF8Encoding]::new($false))
    $parsedIndex = $indexContent | ConvertFrom-Json
    if ($parsedIndex) {
        foreach ($key in $parsedIndex.psobject.properties.Name) {
            $val = $parsedIndex.$key
            if ($key -eq "plugins" -and $val) {
                $pArr = [System.Collections.ArrayList]::new()
                foreach ($p in $val) {
                    $pObj = [ordered]@{}
                    foreach ($pProp in $p.psobject.properties) {
                        if ($pProp.Name -eq "releases" -and $pProp.Value) {
                            $rArr = [System.Collections.ArrayList]::new()
                            foreach ($r in $pProp.Value) {
                                $rObj = [ordered]@{}
                                foreach ($rProp in $r.psobject.properties) {
                                    if ($rProp.Name -eq "permissions" -or $rProp.Name -eq "blocks") {
                                        $subArr = [System.Collections.ArrayList]::new()
                                        if ($rProp.Value) {
                                            foreach ($item in $rProp.Value) {
                                                [void]$subArr.Add($item)
                                            }
                                        }
                                        $rObj[$rProp.Name] = $subArr
                                    } else {
                                        $rObj[$rProp.Name] = $rProp.Value
                                    }
                                }
                                [void]$rArr.Add($rObj)
                            }
                            $pObj["releases"] = $rArr
                        } else {
                            $pObj[$pProp.Name] = $pProp.Value
                        }
                    }
                    [void]$pArr.Add($pObj)
                }
                $indexData[$key] = $pArr
            } else {
                $indexData[$key] = $val
            }
        }
    }
}

if (-not $indexData.Contains("plugins")) {
    $indexData["plugins"] = [System.Collections.ArrayList]::new()
}

$indexData["updatedAt"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
if (-not $indexData.Contains("schemaVersion")) {
    $indexData["schemaVersion"] = 1
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceFolders = Get-ChildItem -Path $sourcesDir -Directory

foreach ($srcFolder in $sourceFolders) {
    $pluginJsonPath = Join-Path $srcFolder.FullName "plugin.json"
    if (-not (Test-Path $pluginJsonPath)) {
        Write-Warning "Skipping $($srcFolder.Name): plugin.json not found."
        continue
    }

    try {
        $pluginJsonText = [System.IO.File]::ReadAllText($pluginJsonPath, [System.Text.UTF8Encoding]::new($false))
        $pluginMeta = $pluginJsonText | ConvertFrom-Json
    } catch {
        Write-Error "Failed to parse plugin.json for $($srcFolder.Name): $_"
        continue
    }

    $id = $pluginMeta.id
    $version = $pluginMeta.version
    $name = $pluginMeta.name
    $description = $pluginMeta.description
    $author = $pluginMeta.author
    $icon = $pluginMeta.icon
    $rawPermissions = $pluginMeta.permissions
    $rawBlocks = $pluginMeta.blocks

    if (-not $id -or -not $version) {
        Write-Error "Invalid plugin.json in $($srcFolder.Name): 'id' and 'version' are required."
        continue
    }

    # Optional market.json
    $marketJsonPath = Join-Path $srcFolder.FullName "market.json"
    $marketMeta = $null
    if (Test-Path $marketJsonPath) {
        try {
            $marketJsonText = [System.IO.File]::ReadAllText($marketJsonPath, [System.Text.UTF8Encoding]::new($false))
            $marketMeta = $marketJsonText | ConvertFrom-Json
        } catch {
            Write-Warning "Failed to parse market.json for $id"
        }
    }

    $destVersionDir = Join-Path $pluginsDir "$id/$version"
    if (-not (Test-Path $destVersionDir)) {
        New-Item -ItemType Directory -Force -Path $destVersionDir | Out-Null
    }

    $zipPath = Join-Path $destVersionDir "plugin.zip"
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }

    # Create zip archive
    $zipFile = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -Path $srcFolder.FullName -Recurse -File
        foreach ($file in $files) {
            $fileName = $file.Name
            if ($fileName -eq "market.json" -or $fileName -eq ".DS_Store" -or $fileName -eq "Thumbs.db") {
                continue
            }

            $relPath = $file.FullName.Substring($srcFolder.FullName.Length + 1)
            $relPathNormalized = $relPath -replace '\\', '/'

            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipFile, $file.FullName, $relPathNormalized, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally {
        $zipFile.Dispose()
    }

    # Calculate SHA256
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $hashBytes = $hasher.ComputeHash($fs)
        $sha256Hash = [BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()
    }
    finally {
        $fs.Dispose()
        $hasher.Dispose()
    }

    $sha256SumLine = "$sha256Hash *plugin.zip"
    $sha256SumPath = Join-Path $destVersionDir "SHA256SUMS"
    [System.IO.File]::WriteAllText($sha256SumPath, $sha256SumLine, [System.Text.UTF8Encoding]::new($false))

    $downloadUrl = "https://raw.githubusercontent.com/mentalchaos0x2b/TMAdminPlugins/main/plugins/$id/$version/plugin.zip"

    # Prepare permissions ArrayList
    $permList = [System.Collections.ArrayList]::new()
    if ($rawPermissions) {
        foreach ($p in $rawPermissions) {
            [void]$permList.Add($p)
        }
    }

    # Prepare blocks ArrayList
    $blocksList = [System.Collections.ArrayList]::new()
    if ($rawBlocks) {
        foreach ($b in $rawBlocks) {
            $bObj = [ordered]@{}
            foreach ($prop in $b.psobject.properties) {
                if ($prop.Name -eq "defaultSize" -or $prop.Name -eq "minSize") {
                    $szObj = [ordered]@{}
                    foreach ($szProp in $prop.Value.psobject.properties) {
                        $szObj[$szProp.Name] = $szProp.Value
                    }
                    $bObj[$prop.Name] = $szObj
                } else {
                    $bObj[$prop.Name] = $prop.Value
                }
            }
            [void]$blocksList.Add($bObj)
        }
    }

    $releaseObj = [ordered]@{
        "version" = $version
        "minAppVersion" = if ($marketMeta -and $marketMeta.minAppVersion) { $marketMeta.minAppVersion } else { "0.1.0" }
        "releasedAt" = if ($marketMeta -and $marketMeta.releasedAt) { $marketMeta.releasedAt } else { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
        "changelog" = if ($marketMeta -and $marketMeta.changelog) { $marketMeta.changelog } else { "Release version $version" }
        "downloadUrl" = $downloadUrl
        "sha256" = $sha256Hash
        "permissions" = $permList
        "blocks" = $blocksList
    }

    # Find existing plugin
    $existingPlugin = $null
    foreach ($p in $indexData["plugins"]) {
        if ($p.id -eq $id) {
            $existingPlugin = $p
            break
        }
    }

    if (-not $existingPlugin) {
        $newPlugin = [ordered]@{
            "id" = $id
            "name" = if ($marketMeta -and $marketMeta.name) { $marketMeta.name } else { $name }
            "description" = if ($marketMeta -and $marketMeta.description) { $marketMeta.description } else { $description }
            "author" = if ($marketMeta -and $marketMeta.author) { $marketMeta.author } else { $author }
            "category" = if ($marketMeta -and $marketMeta.category) { $marketMeta.category } else { "system" }
            "icon" = if ($marketMeta -and $marketMeta.icon) { $marketMeta.icon } else { $icon }
            "repository" = if ($marketMeta -and $marketMeta.repository) { $marketMeta.repository } else { "https://github.com/mentalchaos0x2b/TMAdminPlugins" }
            "license" = if ($marketMeta -and $marketMeta.license) { $marketMeta.license } else { "MIT" }
            "latestVersion" = $version
            "releases" = [System.Collections.ArrayList]@($releaseObj)
        }
        [void]$indexData["plugins"].Add($newPlugin)
    } else {
        if ($marketMeta) {
            if ($marketMeta.name) { $existingPlugin.name = $marketMeta.name }
            if ($marketMeta.description) { $existingPlugin.description = $marketMeta.description }
            if ($marketMeta.author) { $existingPlugin.author = $marketMeta.author }
            if ($marketMeta.category) { $existingPlugin.category = $marketMeta.category }
            if ($marketMeta.icon) { $existingPlugin.icon = $marketMeta.icon }
            if ($marketMeta.repository) { $existingPlugin.repository = $marketMeta.repository }
            if ($marketMeta.license) { $existingPlugin.license = $marketMeta.license }
        } else {
            if ($name) { $existingPlugin.name = $name }
            if ($description) { $existingPlugin.description = $description }
            if ($author) { $existingPlugin.author = $author }
            if ($icon) { $existingPlugin.icon = $icon }
        }

        $existingPlugin.latestVersion = $version

        if ($existingPlugin.releases -isnot [System.Collections.ArrayList]) {
            $relArr = [System.Collections.ArrayList]::new()
            if ($existingPlugin.releases) {
                foreach ($r in $existingPlugin.releases) {
                    [void]$relArr.Add($r)
                }
            }
            $existingPlugin.releases = $relArr
        }

        $foundRelease = $null
        foreach ($r in $existingPlugin.releases) {
            if ($r.version -eq $version) {
                $foundRelease = $r
                break
            }
        }

        if ($foundRelease) {
            $foundRelease.minAppVersion = $releaseObj.minAppVersion
            $foundRelease.releasedAt = $releaseObj.releasedAt
            $foundRelease.changelog = $releaseObj.changelog
            $foundRelease.downloadUrl = $releaseObj.downloadUrl
            $foundRelease.sha256 = $releaseObj.sha256
            $foundRelease.permissions = $releaseObj.permissions
            $foundRelease.blocks = $releaseObj.blocks
        } else {
            [void]$existingPlugin.releases.Add($releaseObj)
        }
    }

    Write-Host "Processed plugin: $id ($version)" -ForegroundColor Green
    Write-Host "  ZIP: $zipPath"
    Write-Host "  SHA256: $sha256Hash"
}

$indexData["updatedAt"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$jsonOutput = $indexData | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($indexJsonPath, $jsonOutput, [System.Text.UTF8Encoding]::new($false))

Write-Host "Build completed successfully. index.json updated." -ForegroundColor Green
