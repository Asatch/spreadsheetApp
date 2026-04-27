# Launch the sc self-host server and open the browser.
# Works on Windows — uses PowerShell's built-in .NET HTTP listener.
# Right-click this file → "Run with PowerShell"

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Port = 21845
$PersistDir = Join-Path $PSScriptRoot "persist"
$Url = "http://localhost:$Port/"

# Create persist directory
if (-not (Test-Path $PersistDir)) { New-Item -ItemType Directory -Path $PersistDir | Out-Null }

# Check if port is already in use
try {
    $conn = [System.Net.Sockets.TcpClient]::new()
    $conn.Connect("127.0.0.1", $Port)
    $conn.Close()
    Write-Host "Port $Port already in use - opening browser to existing server."
    Start-Process $Url
    exit
} catch {
    # Port is free — continue
}

Write-Host "Starting sc on $Url"
Write-Host "Data stored in $PersistDir\"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add($Url)
$Listener.Start()

Start-Process $Url

function Send-Response($context, $status, $body, $contentType) {
    $response = $context.Response
    $response.StatusCode = $status
    $response.Headers.Add("X-SC-Self-Hosted", "1")
    if ($contentType) { $response.ContentType = $contentType }
    if ($body) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $response.Close()
}

function Send-Bytes($context, $status, $bytes, $contentType) {
    $response = $context.Response
    $response.StatusCode = $status
    $response.Headers.Add("X-SC-Self-Hosted", "1")
    if ($contentType) { $response.ContentType = $contentType }
    if ($bytes) {
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $response.Close()
}

$Sep = [System.IO.Path]::DirectorySeparatorChar

function Get-SafePath($requested) {
    $full = [System.IO.Path]::GetFullPath((Join-Path $PersistDir $requested))
    $prefix = $PersistDir + $Sep
    if ($full -ne $PersistDir -and -not $full.StartsWith($prefix)) { return $null }
    return $full
}

function Get-AppHtml {
    $htmls = @(Get-ChildItem -File -Path $PSScriptRoot -Filter *.html)
    if ($htmls.Count -eq 1) { return $htmls[0].Name }
    return $null
}

$MimeTypes = @{
    ".html" = "text/html"; ".js" = "application/javascript"; ".css" = "text/css"
    ".json" = "application/json"; ".xml" = "application/xml"; ".svg" = "image/svg+xml"
    ".png" = "image/png"; ".ico" = "image/x-icon"; ".woff2" = "font/woff2"
}

try {
    while ($Listener.IsListening) {
        $context = $Listener.GetContext()
        $method = $context.Request.HttpMethod
        $path = $context.Request.Url.AbsolutePath

        # /persist/ endpoints
        if ($path -eq "/persist" -or $path -eq "/persist/") {
            if ($method -eq "GET") {
                $files = @()
                if (Test-Path $PersistDir) {
                    Get-ChildItem -Recurse -File $PersistDir | ForEach-Object {
                        $files += $_.FullName.Substring($PersistDir.Length + 1).Replace("\", "/")
                    }
                }
                Send-Response $context 200 ($files | ConvertTo-Json -Compress) "application/json"
            } else {
                Send-Response $context 405 "Method not allowed" "text/plain"
            }
            continue
        }

        if ($path.StartsWith("/persist/")) {
            $rel = $path.Substring("/persist/".Length)
            $fpath = Get-SafePath $rel
            if (-not $fpath) {
                Send-Response $context 403 "Invalid path" "text/plain"
                continue
            }

            switch ($method) {
                "GET" {
                    if (Test-Path $fpath) {
                        $bytes = [System.IO.File]::ReadAllBytes($fpath)
                        Send-Bytes $context 200 $bytes "application/octet-stream"
                    } else {
                        Send-Response $context 404 "Not found" "text/plain"
                    }
                }
                "PUT" {
                    $dir = [System.IO.Path]::GetDirectoryName($fpath)
                    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                    $ms = [System.IO.MemoryStream]::new()
                    $context.Request.InputStream.CopyTo($ms)
                    [System.IO.File]::WriteAllBytes($fpath, $ms.ToArray())
                    $ms.Dispose()
                    Write-Host "  PUT $rel"
                    Send-Response $context 204 $null $null
                }
                "DELETE" {
                    if (Test-Path $fpath) { Remove-Item $fpath }
                    Write-Host "  DEL $rel"
                    Send-Response $context 204 $null $null
                }
                default { Send-Response $context 405 "Method not allowed" "text/plain" }
            }
            continue
        }

        # Redirect / (and /?...) to the single .html in the folder
        if ($method -eq "GET" -and $path -eq "/") {
            $app = Get-AppHtml
            if ($app) {
                $query = $context.Request.Url.Query
                $context.Response.Headers.Add("Location", "/$app$query")
                Send-Response $context 302 $null $null
                continue
            }
        }

        # Static file serving
        if ($method -eq "GET") {
            $filePath = $path.TrimStart("/")
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $filePath))

            $rootPrefix = $PSScriptRoot + $Sep
            if ($fullPath -ne $PSScriptRoot -and -not $fullPath.StartsWith($rootPrefix)) {
                Send-Response $context 403 "Forbidden" "text/plain"
                continue
            }

            if (Test-Path $fullPath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($fullPath)
                $mime = $MimeTypes[$ext]
                if (-not $mime) { $mime = "application/octet-stream" }
                $bytes = [System.IO.File]::ReadAllBytes($fullPath)
                Send-Bytes $context 200 $bytes $mime
            } else {
                Send-Response $context 404 "Not found" "text/plain"
            }
        } else {
            Send-Response $context 405 "Method not allowed" "text/plain"
        }
    }
} finally {
    $Listener.Stop()
}
