param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [ValidateRange(1, 100)][int]$SampleSize = 100,
  [ValidateRange(0, 33)][int]$PerLanguage = 0,
  [string]$OutputDirectory = '',
  [string[]]$ExcludeSamples = @(),
  [switch]$IncludeTrainKazakh,
  [switch]$AvailabilityOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$outDir = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot 'private-data' }
$python = (Get-Command python.exe -ErrorAction Stop).Source
$helper = Join-Path $PSScriptRoot 'prepare-classifier-eval.py'
$arguments = @(
  $helper, '--archive', $archivePath,
  '--prompt', (Join-Path $projectRoot 'classifier-prompt.md'),
  '--output-directory', $outDir,
  '--sample-size', [string]$SampleSize,
  '--per-language', [string]$PerLanguage
)
foreach ($sample in $ExcludeSamples) {
  $arguments += @('--exclude-sample', (Resolve-Path -LiteralPath $sample).Path)
}
if ($IncludeTrainKazakh) { $arguments += '--include-train-kazakh' }
if ($AvailabilityOnly) { $arguments += '--availability-only' }
# The standard-library helper reads archive members without extracting them.
# Its stdout contains aggregates/hashes only; AvailabilityOnly writes no files.
& $python @arguments
if ($LASTEXITCODE -ne 0) { throw 'Evaluation preparation failed; no API requests were made.' }
