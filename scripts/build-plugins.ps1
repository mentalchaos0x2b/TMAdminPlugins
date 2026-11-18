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
    $indexContent = [System.IO.File]::ReadAllText($indexJsonPath, (New-Object System.Text.UTF8Encoding $false))
    $parsedIndex = $indexContent | ConvertFrom-Json
    if ($parsedIndex) {
        foreach ($key in $parsedIndex.psobject.properties.Name) {
            $indexData[$key] = $parsedIndex.$key
        }
    }
}
if (-not $indexData.Contains("plugins")) {
    $indexData["plugins"] = [ordered]@{}
}
$indexData["updatedAt"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

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
        $pluginJsonText = [System.IO.File]::ReadAllText($pluginJsonPath, (New-Object System.Text.UTF8Encoding $false))
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
    $permissions = $pluginMeta.permissions
    $blocks = $pluginMeta.blocks

    if (-not $id -or -not $version) {
        Write-Error "Invalid plugin.json in $($srcFolder.Name): 'id' and 'version' are required."
        continue
    }

    # Optional market.json
    $marketJsonPath = Join-Path $srcFolder.FullName "market.json"
    $marketMeta = $null
    if (Test-Path $marketJsonPath) {
        try {
            $marketJsonText = [System.IO.File]::ReadAllText($marketJsonPath, (New-Object System.Text.UTF8Encoding $false))
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

    # Create zip archive carefully excluding market.json, .DS_Store, Thumbs.db
    $zipFile = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -Path $srcFolder.FullName -Recurse -File
        foreach ($file in $files) {
            $fileName = $file.Name
            if ($fileName -eq "market.json" -or $fileName -eq ".DS_Store" -or $fileName -eq "Thumbs.db") {
                continue
            }

            # Relative path from source folder root
            $relPath = $file.FullName.Substring($srcFolder.FullName.Length + 1)
            $relPathNormalized = $relPath -replace '\\', '/'

            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipFile, $file.FullName, $relPathNormalized, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally {
        $zipFile.Dispose()
    }

    # Calculate SHA256
    $sha256Hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
    $sha256SumLine = "$sha256Hash *plugin.zip"
    $sha256SumPath = Join-Path $destVersionDir "SHA256SUMS"
    [System.IO.File]::WriteAllText($sha256SumPath, $sha256SumLine, (New-Object System.Text.UTF8Encoding $false))

    # Update index.json structure
    $downloadUrl = "https://raw.githubusercontent.com/mentalchaos0x2b/TMAdminPlugins/main/plugins/$id/$version/plugin.zip"

    $pluginEntry = [ordered]@{
        "id" = $id
        "version" = $version
        "name" = $name
        "description" = $description
        "author" = $author
        "icon" = $icon
        "downloadUrl" = $downloadUrl
        "sha256" = $sha256Hash
        "permissions" = $permissions
        "blocks" = $blocks
    }

    if ($marketMeta) {
        if ($marketMeta.category) { $pluginEntry["category"] = $marketMeta.category }
        if ($marketMeta.license) { $pluginEntry["license"] = $marketMeta.license }
        if ($marketMeta.repository) { $pluginEntry["repository"] = $marketMeta.repository }
        if ($marketMeta.minAppVersion) { $pluginEntry["minAppVersion"] = $marketMeta.minAppVersion }
        if ($marketMeta.changelog) { $pluginEntry["changelog"] = $marketMeta.changelog }
    }

    # Ensure plugins hashtable has the entry
    $pluginsDict = $indexData["plugins"]
    if ($pluginsDict -is [System.Collections.IDictionary]) {
        if (-not $pluginsDict.Contains($id)) {
            $pluginsDict[$id] = [ordered]@{}
        }
        $versionDict = $pluginsDict[$id]
        if (-not $versionDict) {
            $versionDict = [ordered]@{}
            $pluginsDict[$id] = $versionDict
        }
        if ($versionDict -is [System.Collections.IDictionary]) {
            $versionDict["latestVersion"] = $version
            $versionDict[$version] = $pluginEntry
        } else {
            $newVersionDict = [ordered]@{}
            foreach ($k in $versionDict.psobject.properties.Name) {
                $newVersionDict[$k] = $versionDict.$k
            }
            $newVersionDict["latestVersion"] = $version
            $newVersionDict[$version] = $pluginEntry
            $pluginsDict[$id] = $newVersionDict
        }
    } else {
        $newPluginsDict = [ordered]@{}
        foreach ($key in $pluginsDict.psobject.properties.Name) {
            $newPluginsDict[$key] = $pluginsDict.$key
        }
        if (-not $newPluginsDict.Contains($id)) {
            $newPluginsDict[$id] = [ordered]@{}
        }
        $targetVerDict = $newPluginsDict[$id]
        if (-not $targetVerDict) {
            $targetVerDict = [ordered]@{}
            $newPluginsDict[$id] = $targetVerDict
        }
        if ($targetVerDict -is [System.Collections.IDictionary]) {
            $targetVerDict["latestVersion"] = $version
            $targetVerDict[$version] = $pluginEntry
        } else {
            $newVerDict = [ordered]@{}
            foreach ($k in $targetVerDict.psobject.properties.Name) {
                $newVerDict[$k] = $targetVerDict.$k
            }
            $newVerDict["latestVersion"] = $version
            $newVerDict[$version] = $pluginEntry
            $newPluginsDict[$id] = $newVerDict
        }
        $indexData["plugins"] = $newPluginsDict
    }

    Write-Host "Processed plugin: $id ($version)" -ForegroundColor Green
    Write-Host "  ZIP: $zipPath"
    Write-Host "  SHA256: $sha256Hash"
}

$indexData["updatedAt"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Save index.json as UTF-8 without BOM
$jsonOutput = $indexData | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($indexJsonPath, $jsonOutput, (New-Object System.Text.UTF8Encoding $false))

Write-Host "Build completed successfully. index.json updated." -ForegroundColor Green
