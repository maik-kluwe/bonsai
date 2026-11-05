# Builds the demo repo for the README screenshots (images/*.png): a small map app with branches, tags, a stash and open changes.
# Usage: .\scripts\screenshots\new-repo.ps1 [-Path C:\temp\bonsai-shots] [-Conflict]
#   -Conflict  drops the open changes and then starts a merge that conflicts in src/map.ts (for merge.png)
param([string]$Path = "$env:TEMP\bonsai-shots", [switch]$Conflict)

$ErrorActionPreference = 'Stop'
if (Test-Path $Path) { Get-ChildItem -LiteralPath $Path -Force | Remove-Item -Recurse -Force } else { New-Item -ItemType Directory $Path | Out-Null }
$remote = "$Path-remote.git"
if (Test-Path $remote) { Remove-Item $remote -Recurse -Force }

$people = @{
  Lena  = @('Lena Hoffmann', 'lena@example.com')
  Jonas = @('Jonas Weber', 'jonas@example.com')
  Amira = @('Amira Haddad', 'amira@example.com')
  Marek = @('Marek Novak', 'marek@example.com')
}

function Write-Text([string]$file, [string]$text) {
  $full = Join-Path $Path $file
  New-Item -ItemType Directory -Force (Split-Path $full) | Out-Null
  $text = $text.Replace("`r`n", "`n")
  if (-not $text.EndsWith("`n")) { $text += "`n" }
  [IO.File]::WriteAllText($full, $text, [Text.UTF8Encoding]::new($false))
}
function Add-Line([string]$file, [string]$line) {
  $full = Join-Path $Path $file
  $old = if (Test-Path $full) { [IO.File]::ReadAllText($full) } else { '' }
  Write-Text $file ($old + $line + "`n")
}
function Edit-Text([string]$file, [string]$from, [string]$to) {
  $full = Join-Path $Path $file
  Write-Text $file ([IO.File]::ReadAllText($full).Replace($from, $to))
}
# Commit with author and time (October 2026 is CEST)
function Save([string]$who, [string]$when, [string]$message, [switch]$NoCommit) {
  $name, $email = $people[$who]
  $stamp = "$when+02:00"
  $env:GIT_AUTHOR_NAME = $env:GIT_COMMITTER_NAME = $name
  $env:GIT_AUTHOR_EMAIL = $env:GIT_COMMITTER_EMAIL = $email
  $env:GIT_AUTHOR_DATE = $env:GIT_COMMITTER_DATE = $stamp
  git add -A
  git commit -q -m $message
}

Push-Location $Path
try {
  git init -q -b main
  git config user.name Demo
  git config user.email demo@example.com
  git config core.autocrlf false

  $mapBase = @"
import { Tile, loadTile } from './tiles';

export async function getTile(key: string) {
  return loadTile(key);
}

export function drawTiles(ctx: CanvasRenderingContext2D, tiles: Tile[]) {
  for (const tile of tiles) ctx.drawImage(tile.image, tile.x, tile.y);
}

export const style = 'day';
"@
  $mapCached = @"
import { Tile, loadTile } from './tiles';

export const CACHE_LIMIT = 800;
const cache = new Map<string, Tile>();

export async function getTile(key: string) {
  const hit = cache.get(key);
  if (hit) return hit;
  const tile = await loadTile(key);
  if (cache.size >= CACHE_LIMIT) evictOldest();
  cache.set(key, tile);
  return tile;
}

function evictOldest() {
  const first = cache.keys().next().value;
  if (first) cache.delete(first);
}

export function drawTiles(ctx: CanvasRenderingContext2D, tiles: Tile[]) {
  for (const tile of tiles) ctx.drawImage(tile.image, tile.x, tile.y);
}

export const style = 'day';
"@

  # main and the side branches in chronological order
  Write-Text 'src/route.ts' "export interface Route { id: string; points: number[][]; }`n"
  Save Lena '2026-10-20T14:00:00' 'Add route model'
  git tag v0.1.0

  Write-Text 'src/map.ts' $mapBase
  Write-Text 'src/tiles.ts' "export interface Tile { key: string; image: CanvasImageSource; x: number; y: number; }`nexport async function loadTile(key: string): Promise<Tile> {`n  throw new Error('not implemented ' + key);`n}`n"
  Save Jonas '2026-10-20T17:15:00' 'Render the map tiles'

  git checkout -q -b feature/elevation
  Write-Text 'src/elevation.ts' "export function readElevation(gpx: string): number[] {`n  return [...gpx.matchAll(/<ele>([\d.]+)<\/ele>/g)].map(m => Number(m[1]));`n}`n"
  Save Amira '2026-10-20T18:41:00' 'Read elevation data from GPX files'
  Add-Line 'src/elevation.ts' "export function drawProfile(ctx: CanvasRenderingContext2D, values: number[]) {`n  values.forEach((v, i) => ctx.lineTo(i, -v));`n}"
  Save Amira '2026-10-20T21:31:00' 'Draw the elevation profile'
  git checkout -q main

  Write-Text 'src/map.ts' $mapCached
  Save Lena '2026-10-20T23:24:00' 'Fix tile cache growing without limit'
  Write-Text 'src/settings.ts' "export const labels = { language: 'Sprache', units: 'Einheiten' };`n"
  Save Marek '2026-10-21T02:18:00' 'Translate the settings page'

  git checkout -q -b bugfix/km-rounding
  Write-Text 'src/format.ts' "export const km = (m: number) => (m / 1000).toFixed(1);`n"
  Save Jonas '2026-10-21T05:01:00' 'Round distances to one decimal'
  git checkout -q main

  Write-Text 'src/stats.ts' "export const ascent = (values: number[]) => values.reduce((sum, v, i) => sum + Math.max(0, v - (values[i - 1] ?? v)), 0);`n"
  Save Amira '2026-10-21T08:19:00' 'Show total ascent next to the distance'
  $env:GIT_AUTHOR_NAME = $env:GIT_COMMITTER_NAME = 'Lena Hoffmann'; $env:GIT_AUTHOR_EMAIL = $env:GIT_COMMITTER_EMAIL = 'lena@example.com'
  $env:GIT_AUTHOR_DATE = $env:GIT_COMMITTER_DATE = '2026-10-21T09:42:00+02:00'
  git merge -q --no-ff bugfix/km-rounding -m "Merge branch 'bugfix/km-rounding'"
  git tag v0.2.0

  Write-Text 'src/offline.ts' "export const regions: string[] = [];`n"
  Save Lena '2026-10-21T12:46:00' 'Add offline download for regions'
  Add-Line 'src/offline.ts' "export const progress = (done: number, total: number) => Math.round((done / total) * 100) + ' %';"
  Save Lena '2026-10-21T14:46:00' 'Show download progress in the status bar'

  git checkout -q feature/elevation
  Add-Line 'src/elevation.ts' "export const steepness = (a: number, b: number) => Math.abs(b - a);"
  Save Amira '2026-10-21T17:51:00' 'Colour the profile by steepness'
  git checkout -q main
  $env:GIT_AUTHOR_NAME = $env:GIT_COMMITTER_NAME = 'Lena Hoffmann'; $env:GIT_AUTHOR_EMAIL = $env:GIT_COMMITTER_EMAIL = 'lena@example.com'
  $env:GIT_AUTHOR_DATE = $env:GIT_COMMITTER_DATE = '2026-10-21T19:14:00+02:00'
  git merge -q --no-ff feature/elevation -m "Merge branch 'feature/elevation'"
  git tag v0.3.0

  Write-Text 'src/share.ts' "export const shareUrl = (id: string) => '/r/' + id;`n"
  Save Jonas '2026-10-21T22:17:00' 'Export a route as share link'
  git checkout -q -b feature/sharing
  Add-Line 'src/share.ts' 'export function qr() {}'
  Save Jonas '2026-10-22T00:38:00' 'Add a QR code to the share dialog'
  git checkout -q main

  Edit-Text 'src/map.ts' "'day'" "'dusk'"
  Save Marek '2026-10-22T02:20:00' 'Update the map style for dark mode'
  Write-Text 'src/storage.ts' "export const lastRoute = { get: () => localStorage.getItem('route'), set: (id: string) => localStorage.setItem('route', id) };`n"
  Save Lena '2026-10-22T04:57:00' 'Remember the last opened route'

  git init -q --bare $remote
  git remote add origin $remote
  git push -q -u origin main feature/sharing
  git branch -q --unset-upstream main   # without an upstream the sidebar shows no ahead/behind, as in the screenshots
  git branch -q --unset-upstream feature/sharing

  Add-Line 'src/offline.ts' 'export const MAX_GB = 2;'
  Save Lena '2026-10-22T07:35:00' 'Limit offline regions to 2 GB'
  Add-Line 'src/tiles.ts' 'export const TILE_SIZE = 256;'
  Save Jonas '2026-10-22T11:05:00' 'Move tile loading into its own module'

  # Stash "Draft of the search box"
  Write-Text 'src/search.ts' "export const search = (q: string) => q.trim().toLowerCase();`n"
  git add src/search.ts
  $env:GIT_COMMITTER_DATE = '2026-10-22T11:05:00+02:00'
  git stash push -q -m 'Draft of the search box'

  # Open changes: map.ts with two hunks, route.ts staged, NOTES.md untracked
  $map = [IO.File]::ReadAllText("$Path\src\map.ts")
  $map = $map.Replace("export const CACHE_LIMIT = 800;", "export const CACHE_LIMIT = 1200;`nexport const CACHE_TTL_DAYS = 14;")
  $map = $map.Replace("  if (first) cache.delete(first);", "  if (first) {`n    cache.delete(first);`n    console.debug('evicted', first);`n  }")
  $map = $map.Replace("'dusk'", "'night'")
  Write-Text 'src/map.ts' $map
  Add-Line 'src/route.ts' 'export const DEFAULT_ZOOM = 14;'
  git add src/route.ts
  Write-Text 'NOTES.md' "# Notes`n`n- tile cache: check the memory limit on old phones`n"

  if ($Conflict) {
    git checkout -q -- .
    git reset -q
    Remove-Item NOTES.md
    Edit-Text 'src/map.ts' 'CACHE_LIMIT = 800;' "CACHE_LIMIT = 800;`nexport const CACHE_TTL_DAYS = 14;"
    Save Lena (Get-Date -Format s) 'Keep tiles for 14 days'
    git checkout -q -b feature/tile-settings
    Edit-Text 'src/map.ts' 'export const CACHE_LIMIT = 800;' "// Phones with little memory keep fewer tiles`nexport const CACHE_LIMIT = navigator.deviceMemory > 4 ? 1200 : 400;"
    Edit-Text 'src/map.ts' "'dusk'" "'terrain'"
    Save Jonas (Get-Date -Format s) 'Scale the tile cache with device memory'
    git checkout -q main
    Edit-Text 'src/map.ts' 'CACHE_LIMIT = 800;' 'CACHE_LIMIT = 1000;'
    Edit-Text 'src/map.ts' "'dusk'" "'night'"
    Save Marek (Get-Date -Format s) 'Hide map labels by default'
    Remove-Item Env:GIT_AUTHOR_DATE, Env:GIT_COMMITTER_DATE
    git merge feature/tile-settings 2>&1 | Out-Null   # ends with a conflict, exit code 1 is intended
  }

  git log --oneline --graph --all
  git status --short
  Write-Host "`nShots-Repo: $Path  (Remote: $remote)"
}
finally {
  Remove-Item Env:GIT_AUTHOR_NAME, Env:GIT_AUTHOR_EMAIL, Env:GIT_COMMITTER_NAME, Env:GIT_COMMITTER_EMAIL, Env:GIT_AUTHOR_DATE, Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue
  Pop-Location
}
