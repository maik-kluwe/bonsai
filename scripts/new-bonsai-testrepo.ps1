# Rebuilds the Bonsai test repo (as in the Linux sandbox) plus extra Windows test cases.
# Usage: .\scripts\new-bonsai-testrepo.ps1 [-Path C:\temp\bonsai-demo]
param([string]$Path = "$env:TEMP\bonsai-demo")

$ErrorActionPreference = 'Stop'
# Empty the folder instead of deleting it: VS Code and Fork may hold it open (a handle on the folder itself)
if (Test-Path $Path) { Get-ChildItem -LiteralPath $Path -Force | Remove-Item -Recurse -Force } else { New-Item -ItemType Directory $Path | Out-Null }
$remote = "$Path-remote.git"
if (Test-Path $remote) { Remove-Item $remote -Recurse -Force }

# Every commit gets its own timestamp (5 minutes apart), otherwise the graph order is arbitrary on a tie
$script:clock = [datetime]'2026-11-03T10:00:00'
function Tick {
  $script:clock = $script:clock.AddMinutes(5)
  $env:GIT_AUTHOR_DATE = $env:GIT_COMMITTER_DATE = $script:clock.ToString('s') + '+01:00'
}

Push-Location $Path
try {
  git init -q -b main
  git config user.email demo@example.com
  git config user.name Demo
  git config core.autocrlf false   # deliberately off for the CRLF test below; set it to true later to compare

  function C([string]$msg, [string]$file) { Tick; Add-Content $file $msg; git add -A; git commit -qm $msg }

  # History: feature branch merged with --no-ff, open hotfix branch, tag
  C 'init' 'f.txt'
  C 'main 1' 'f.txt'
  git checkout -qb feature
  C 'feat 1' 'feat.txt'
  C 'feat 2' 'feat.txt'
  git checkout -q main
  C 'main 2' 'f.txt'
  git checkout -qb hotfix
  C 'fix' 'fix.txt'
  git checkout -q main
  Tick; git merge -q --no-ff feature -m 'Merge feature'
  git tag v1.0

  # Pure rename (the details show "Renamed only")
  Tick; git mv f.txt g.txt
  git commit -qm 'rename'

  # Branches with folders (sidebar tree) + a remote with the same branches
  git branch feat/fe-13
  git branch feat/fe-23
  git init -q --bare $remote
  git remote add origin $remote
  git push -q origin --all
  git fetch -q origin

  # File with 40 lines for hunk tests (two separate hunks)
  1..40 | Set-Content nums.txt
  Tick; git add nums.txt; git commit -qm 'nums'

  # Stashes: one with an untracked file (-u), one plain
  (Get-Content nums.txt) -replace '^5$', 'fünf' | Set-Content nums.txt
  'ganz neu' | Set-Content neu.txt
  Tick; git stash push -q -u -m 'mit untracked'
  Add-Content g.txt 'y'
  Tick; git stash push -q -m 'erster'

  # Windows test case: a file with CRLF (for hunk staging with git apply)
  [IO.File]::WriteAllText("$Path\crlf.txt", ((1..20 | ForEach-Object { "zeile $_" }) -join "`r`n") + "`r`n")
  Tick; git add crlf.txt; git commit -qm 'crlf datei'

  # Merge conflicts: three branches, ready to merge. No merge runs on purpose, the state stays clean.
  #   git checkout merge-a ; git merge merge-b      → gross.txt: 2 conflicts + 2 undisputed changes, konflikt.txt: 1 conflict
  #   git checkout merge-a ; git merge merge-del    → konflikt.txt: modify/delete (merge-del deleted the file)
  $gross = 1..12 | ForEach-Object { "zeile $_" }
  $edit = { param($map) $gross | ForEach-Object { if ($map.ContainsKey($_)) { $map[$_] } else { $_ } } }
  $gross | Set-Content gross.txt
  "basis`nzeile 2`nzeile 3" | Set-Content konflikt.txt
  Tick; git add -A; git commit -qm 'merge-konflikte: basis'
  git checkout -qb merge-a
  & $edit @{ 'zeile 2' = 'A zwei'; 'zeile 6' = 'A sechs'; 'zeile 10' = 'A zehn' } | Set-Content gross.txt
  "basis`nA ändert`nzeile 3" | Set-Content konflikt.txt
  Tick; git commit -qam 'merge-a ändert'
  git checkout -q main
  git checkout -qb merge-b
  & $edit @{ 'zeile 2' = 'B zwei'; 'zeile 6' = "B sechs`nB sechs b"; 'zeile 12' = 'B zwölf' } | Set-Content gross.txt
  "basis`nB ändert`nzeile 3" | Set-Content konflikt.txt
  Tick; git commit -qam 'merge-b ändert'
  git checkout -q main
  git checkout -qb merge-del
  git rm -q konflikt.txt
  Tick; git commit -qm 'merge-del löscht konflikt.txt'
  git checkout -q main

  # Ahead/behind in the sidebar: main and feature are ahead of their upstream, hotfix is behind
  git branch -q --set-upstream-to=origin/main main
  git branch -q --set-upstream-to=origin/feature feature
  git branch -q --set-upstream-to=origin/hotfix hotfix
  git checkout -q feature
  C 'feat lokal 1' 'feat.txt'
  C 'feat lokal 2' 'feat.txt'
  git checkout -q hotfix
  C 'fix 2' 'fix.txt'
  git push -q origin hotfix
  git reset -q --hard HEAD~1
  git checkout -q main

  # Long side branch "archive" (200 commits from init) to test loading more history
  $root = (git rev-list --max-parents=0 main).Trim()
  $t0 = [int64](git log -1 --format=%ct $root)
  $fi = New-Object System.Text.StringBuilder
  foreach ($k in 1..200) {
    $m = 'archive {0:000}: {1}' -f $k, $(if ($k % 10 -eq 0) { 'milestone' } else { 'step' })
    $body = "content $k`n"
    [void]$fi.Append("commit refs/heads/archive`ncommitter Demo <demo@example.com> $($t0 + $k * 60) +0000`ndata $($m.Length)`n$m`n")
    if ($k -eq 1) { [void]$fi.Append("from $root`n") }
    [void]$fi.Append("M 100644 inline archive/f$($k % 7).txt`ndata $($body.Length)`n$body`n")
  }
  [IO.File]::WriteAllText("$env:TEMP\bonsai-archive.fi", $fi.ToString().Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
  cmd /c "git fast-import --quiet < `"$env:TEMP\bonsai-archive.fi`""

  # Branch "authors": commits by different authors (initials avatars, Gravatar test with the address from the Gravatar docs)
  $people = @(('Ada Lovelace', 'ada@example.org'), ('Émile Zola', 'emile@example.org'), ('grace', 'grace@example.org'),
              ('Linus Benedict Torvalds', 'linus@example.org'), ('Ada Lovelace', 'ADA@example.org'), ('Gravatar Doc', 'myemailaddress@example.com'))
  $fa = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $people.Count; $i++) {
    $n, $e = $people[$i]; $when = $t0 + 30 * 60 + $i * 60; $m = "authors $($i + 1): $n"; $body = "a$i`n"
    [void]$fa.Append("commit refs/heads/authors`nauthor $n <$e> $when +0000`ncommitter $n <$e> $when +0000`ndata $([Text.Encoding]::UTF8.GetByteCount($m))`n$m`n")
    if ($i -eq 0) { [void]$fa.Append("from $root`n") }
    [void]$fa.Append("M 100644 inline authors/a$i.txt`ndata $($body.Length)`n$body`n")
  }
  [IO.File]::WriteAllText("$env:TEMP\bonsai-authors.fi", $fa.ToString(), [Text.UTF8Encoding]::new($false))
  cmd /c "git fast-import --quiet < `"$env:TEMP\bonsai-authors.fi`""

  # Open local changes: two hunks in nums.txt, a CRLF change, an untracked file, a staged file
  (Get-Content nums.txt) -replace '^3$', 'drei' -replace '^35$', 'fünfunddreißig' | Set-Content nums.txt
  $c = [IO.File]::ReadAllText("$Path\crlf.txt") -replace 'zeile 10', 'zeile ZEHN'
  [IO.File]::WriteAllText("$Path\crlf.txt", $c)
  'neu und ungetrackt' | Set-Content untracked.txt
  Add-Content feat.txt 'gestagt'
  git add feat.txt

  git log --oneline --graph --all
  git status --short
  git branch -vv
  Write-Host "`nTest-Repo: $Path  (Remote: $remote)"
}
finally {
  Remove-Item Env:GIT_AUTHOR_DATE, Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue
  Pop-Location
}
