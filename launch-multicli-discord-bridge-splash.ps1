param(
  [Parameter(Mandatory = $true)]
  [string]$SignalPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SignalPath)) {
  exit 0
}

function Test-BridgeMainWindowVisible {
  $bridgeWindow = Get-Process -Name electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq 'multicli-discord-bridge' } |
    Select-Object -First 1

  return $null -ne $bridgeWindow
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'multicli-discord-bridge'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.ClientSize = New-Object System.Drawing.Size(420, 132)
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ControlBox = $false
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 24)
$form.ForeColor = [System.Drawing.Color]::White

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(22, 18)
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$titleLabel.Text = 'Starting multicli-discord-bridge...'
$form.Controls.Add($titleLabel)

$detailLabel = New-Object System.Windows.Forms.Label
$detailLabel.AutoSize = $false
$detailLabel.Location = New-Object System.Drawing.Point(24, 50)
$detailLabel.Size = New-Object System.Drawing.Size(370, 34)
$detailLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$detailLabel.Text = 'Preparing the Electron window. This message closes automatically when the app is ready.'
$form.Controls.Add($detailLabel)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(24, 92)
$progressBar.Size = New-Object System.Drawing.Size(372, 14)
$progressBar.Style = 'Marquee'
$progressBar.MarqueeAnimationSpeed = 30
$form.Controls.Add($progressBar)

$pollTimer = New-Object System.Windows.Forms.Timer
$pollTimer.Interval = 200
$pollTimer.Add_Tick({
  if ((-not (Test-Path -LiteralPath $SignalPath)) -or (Test-BridgeMainWindowVisible)) {
    $pollTimer.Stop()
    $form.Close()
  }
})

$form.Add_Shown({
  $pollTimer.Start()
  $form.Activate()
})

[void]$form.ShowDialog()
