# Run once after authenticating gh with repository Administration and Actions write access.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repository = 'maxximben/codex'

function Invoke-GitHubApi {
    param([Parameter(Mandatory)][string[]] $Arguments)
    $result = & gh api @Arguments
    if ($LASTEXITCODE) {
        throw 'GitHub rejected the request. Check the token repository access and Administration/Actions write permissions, then rerun this script.'
    }
    return $result
}

$metadata = Invoke-GitHubApi -Arguments @("repos/$repository") | ConvertFrom-Json
if ($metadata.default_branch -ne 'custom-ui') {
    Invoke-GitHubApi -Arguments @('--method', 'PATCH', "repos/$repository", '-f', 'default_branch=custom-ui') | Out-Null
}
$permissions = Invoke-GitHubApi -Arguments @("repos/$repository/actions/permissions") | ConvertFrom-Json
if (-not $permissions.enabled) {
    Invoke-GitHubApi -Arguments @('--method', 'PUT', "repos/$repository/actions/permissions", '-F', 'enabled=true') | Out-Null
}
Invoke-GitHubApi -Arguments @('--method', 'PUT', "repos/$repository/actions/permissions/workflow", '-f', 'default_workflow_permissions=read', '-F', 'can_approve_pull_request_reviews=true') | Out-Null

$workflows = @()
for ($attempt = 0; $attempt -lt 6; $attempt++) {
    $page = Invoke-GitHubApi -Arguments @("repos/$repository/actions/workflows?per_page=100") | ConvertFrom-Json
    $workflows = @($page.workflows)
    if ($workflows | Where-Object path -eq '.github/workflows/custom-ui-update.yml') { break }
    Start-Sleep -Seconds 3
}
foreach ($workflow in $workflows) {
    if ($workflow.path -eq '.github/workflows/custom-ui-update.yml') { continue }
    if ($workflow.path -like '.github/workflows/*' -and $workflow.state -eq 'active') {
        Write-Host "Disabling inherited workflow: $($workflow.path)"
        Invoke-GitHubApi -Arguments @('--method', 'PUT', "repos/$repository/actions/workflows/$($workflow.id)/disable") | Out-Null
    }
}
Invoke-GitHubApi -Arguments @('--method', 'PUT', "repos/$repository/actions/workflows/custom-ui-update.yml/enable") | Out-Null
Invoke-GitHubApi -Arguments @('--method', 'POST', "repos/$repository/actions/workflows/custom-ui-update.yml/dispatches", '-f', 'ref=custom-ui') | Out-Null

$verified = Invoke-GitHubApi -Arguments @("repos/$repository/actions/workflows/custom-ui-update.yml") | ConvertFrom-Json
if ($verified.state -ne 'active') { throw 'The custom UI workflow is not active' }
Write-Host 'Weekly checks are enabled: Mondays at 03:17 UTC / 09:17 Asia/Omsk.'
Write-Host "First run requested: https://github.com/$repository/actions/workflows/custom-ui-update.yml"
