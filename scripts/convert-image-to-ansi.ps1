#!/usr/bin/env pwsh
# Convert an image to foreground-only Unicode block art for tui.header.file.
# Terminal cells are assumed to be twice as tall as they are wide.
param(
    [Parameter(Mandatory)] [string] $InputPath,
    [Parameter(Mandatory)] [string] $OutputPath,
    [ValidateRange(8, 160)] [int] $Columns = 76,
    [string] $PreviewPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourcePath = (Resolve-Path -LiteralPath $InputPath).Path
$destination = [IO.Path]::GetFullPath($OutputPath)
if ($sourcePath -eq $destination) { throw 'The ANSI output must differ from the source image.' }

$source = [Drawing.Image]::FromFile($sourcePath)
$pixels = $null
$graphics = $null
$preview = $null
$previewGraphics = $null
try {
    $rows = [Math]::Max(1, [int][Math]::Round($Columns * $source.Height / $source.Width / 2))
    $pixels = [Drawing.Bitmap]::new($Columns, $rows)
    $graphics = [Drawing.Graphics]::FromImage($pixels)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
    $attributes = [Drawing.Imaging.ImageAttributes]::new()
    try {
        $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $graphics.DrawImage($source, [Drawing.Rectangle]::new(0, 0, $Columns, $rows),
            0, 0, $source.Width, $source.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
    } finally {
        $attributes.Dispose()
    }
    $graphics.Dispose()
    $graphics = $null

    $escape = [char]27
    $text = [Text.StringBuilder]::new()
    $colors = [Collections.Generic.HashSet[int]]::new()
    for ($y = 0; $y -lt $rows; $y++) {
        $lastColor = -1
        for ($x = 0; $x -lt $Columns; $x++) {
            $sample = $pixels.GetPixel($x, $y)
            # Small quantization makes neighboring flat colors share ANSI runs.
            $red = [int][Math]::Min(255, [Math]::Round($sample.R / 8) * 8)
            $green = [int][Math]::Min(255, [Math]::Round($sample.G / 8) * 8)
            $blue = [int][Math]::Min(255, [Math]::Round($sample.B / 8) * 8)
            $color = ($red -shl 16) -bor ($green -shl 8) -bor $blue
            [void]$colors.Add($color)
            if ($color -ne $lastColor) {
                [void]$text.Append("$escape[38;2;$red;$green;${blue}m")
                $lastColor = $color
            }
            [void]$text.Append('█')
            $pixels.SetPixel($x, $y, [Drawing.Color]::FromArgb($red, $green, $blue))
        }
        [void]$text.Append("$escape[0m`n")
    }

    $encoding = [Text.UTF8Encoding]::new($false)
    $content = $text.ToString()
    $bytes = $encoding.GetByteCount($content)
    if ($bytes -gt 65536) { throw "ANSI output is $bytes bytes; reduce Columns to fit the 64 KiB header limit." }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
    [IO.File]::WriteAllText($destination, $content, $encoding)

    if ($PreviewPath) {
        $previewDestination = [IO.Path]::GetFullPath($PreviewPath)
        if ($previewDestination -eq $sourcePath -or $previewDestination -eq $destination) {
            throw 'The preview path must differ from both the source and ANSI output.'
        }
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($previewDestination))
        $preview = [Drawing.Bitmap]::new($Columns * 8, $rows * 16)
        $previewGraphics = [Drawing.Graphics]::FromImage($preview)
        $previewGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $previewGraphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
        $previewGraphics.DrawImage($pixels, 0, 0, $preview.Width, $preview.Height)
        $preview.Save($previewDestination, [Drawing.Imaging.ImageFormat]::Png)
    }

    [pscustomobject]@{
        Path = $destination
        Columns = $Columns
        Rows = $rows
        Bytes = $bytes
        Colors = $colors.Count
    } | ConvertTo-Json -Compress
} finally {
    if ($previewGraphics) { $previewGraphics.Dispose() }
    if ($preview) { $preview.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($pixels) { $pixels.Dispose() }
    $source.Dispose()
}
