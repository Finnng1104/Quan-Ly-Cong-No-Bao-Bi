# qlcn — lệnh hỗ trợ cho bản cài trên Windows (người hỗ trợ dùng, không phải chủ cửa hàng).
#
# Nằm trong gói cài tại <thư mục cài>\app\bin. Installer ghi <thư mục cài>\install.json
# (dataRoot, taskName) để lệnh này biết dữ liệu ở đâu và tác vụ chạy nền tên gì.
#
# CHÚ Ý: mới viết, chưa chạy thử trên Windows thật (giống install.ps1).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Node writes UTF-8; without this PowerShell decodes it with the OEM code page and mangles Vietnamese.
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$BinDir = $PSScriptRoot
$AppDir = Split-Path $BinDir -Parent
$AppRoot = Split-Path $AppDir -Parent
$Node = Join-Path $AppDir 'runtime\node.exe'
$Main = Join-Path $AppDir 'server\dist\main.js'

$installInfo = $null
$installJson = Join-Path $AppRoot 'install.json'
if (Test-Path $installJson) { $installInfo = Get-Content $installJson -Raw | ConvertFrom-Json }
$DataRoot = if ($installInfo -and $installInfo.dataRoot) { $installInfo.dataRoot } else { Join-Path $env:ProgramData 'QuanLyCongNo' }
$TaskName = if ($installInfo -and $installInfo.taskName) { $installInfo.taskName } else { 'QuanLyCongNo' }

function Show-Usage {
  @'
Cách dùng: qlcn <lệnh>

  status              Phiên bản, cổng, tình trạng dịch vụ và bản sao lưu gần nhất
  start | stop | restart
                      Bật / tắt / khởi động lại dịch vụ chạy nền (cần quyền Administrator)
  backup              Sao lưu ngay (dịch vụ vẫn chạy bình thường)
  backups             Liệt kê các bản sao lưu trên máy
  restore <file|ngày> Thay dữ liệu bằng một bản sao lưu (ngày dạng YYYY-MM-DD = bản mới nhất ngày đó).
                      Tự tắt dịch vụ, chụp lại dữ liệu hiện tại, khôi phục rồi bật lại.
                      Thêm --yes để bỏ qua câu hỏi xác nhận. Cần quyền Administrator.
  doctor              Tạo file chẩn đoán (không chứa dữ liệu khách) để gửi hỗ trợ
  logs                Mở thư mục log
  version             In phiên bản
'@ | Write-Host
}

function Invoke-Main([string[]]$Arguments) {
  # Out-Host keeps node's output out of this function's return value, which is only the exit code.
  & $Node $Main @Arguments --data-dir $DataRoot | Out-Host
  return $LASTEXITCODE
}

function Get-Port {
  $configPath = Join-Path $DataRoot 'config.json'
  if (Test-Path $configPath) {
    try {
      $config = Get-Content $configPath -Raw | ConvertFrom-Json
      if ($config.port) { return [int]$config.port }
    } catch { }
  }
  return 8686
}

function Get-Health {
  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$(Get-Port)/api/health" -TimeoutSec 3).Content
  } catch { return $null }
}

function Wait-Until([string]$State, [int]$Seconds) {
  for ($waited = 0; $waited -lt $Seconds; $waited++) {
    $healthy = [bool](Get-Health)
    if (($State -eq 'up' -and $healthy) -or ($State -eq 'down' -and -not $healthy)) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Assert-Admin {
  $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Lệnh này cần quyền Administrator: mở PowerShell bằng "Run as administrator".' -ForegroundColor Red
    exit 2
  }
}

function Stop-QlcnService {
  Assert-Admin
  & schtasks.exe /End /TN $TaskName 2>$null | Out-Null
  # Ending the task does not end the server child process the supervisor started.
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($AppRoot, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (-not (Wait-Until 'down' 15)) { Write-Host 'Cảnh báo: dịch vụ chưa dừng hẳn sau 15 giây' -ForegroundColor Yellow }
}

function Start-QlcnService {
  Assert-Admin
  & schtasks.exe /Run /TN $TaskName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Không chạy được tác vụ $TaskName — chạy lại lệnh cài đặt để đăng ký lại." -ForegroundColor Red
    return $false
  }
  if (Wait-Until 'up' 30) {
    Write-Host "Dịch vụ đang chạy tại http://localhost:$(Get-Port)"
    return $true
  }
  Write-Host 'Dịch vụ không lên được sau 30 giây. Xem log: qlcn logs' -ForegroundColor Red
  return $false
}

function Show-Status {
  $version = & $Node $Main version 2>$null
  Write-Host "Phiên bản : $version"
  Write-Host "Dữ liệu   : $DataRoot"
  Write-Host "Cổng      : $(Get-Port)"
  & schtasks.exe /Query /TN $TaskName 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host "Dịch vụ   : đã đăng ký ($TaskName)" } else { Write-Host 'Dịch vụ   : CHƯA đăng ký' }
  $health = Get-Health
  if ($health) { Write-Host "Sức khỏe  : $health" } else { Write-Host 'Sức khỏe  : KHÔNG phản hồi' }
}

function Show-Backups {
  $dir = Join-Path $DataRoot 'backups'
  $files = @(Get-ChildItem -Path $dir -Filter 'qlcn-*.db.gz' -ErrorAction SilentlyContinue | Sort-Object Name)
  if ($files.Count -eq 0) { Write-Host "Chưa có bản sao lưu nào trong $dir"; return }
  Write-Host "Trong $dir (cũ → mới):"
  # File names start with the UTC time, so sorting by name sorts by time.
  foreach ($file in $files) { Write-Host ('  {0,-55} {1,8:N0} KB' -f $file.Name, ($file.Length / 1KB)) }
}

function Invoke-Restore([string[]]$Arguments) {
  $assumeYes = $Arguments -contains '--yes'
  $source = $Arguments | Where-Object { $_ -ne '--yes' } | Select-Object -First 1
  if (-not $source) { Write-Host 'Cần chỉ rõ file hoặc ngày. Xem danh sách: qlcn backups' -ForegroundColor Red; exit 2 }
  Assert-Admin
  # A bare file name (as printed by `qlcn backups`) means a file in the backup folder.
  $inBackups = Join-Path (Join-Path $DataRoot 'backups') $source
  if (-not (Test-Path $source) -and (Test-Path $inBackups)) { $source = $inBackups }

  if (-not $assumeYes) {
    Write-Host "Sẽ THAY TOÀN BỘ dữ liệu hiện tại bằng: $source"
    Write-Host '(Dữ liệu hiện tại được chụp lại trước, nên vẫn quay lại được.)'
    if ((Read-Host 'Tiếp tục? [y/N]') -notin @('y', 'Y')) { Write-Host 'Đã hủy.'; exit 1 }
  }

  Write-Host 'Đang dừng dịch vụ...'
  Stop-QlcnService
  $exitCode = Invoke-Main @('restore', $source)
  # Start again whatever happened: a failed restore leaves the current data untouched.
  Write-Host 'Đang bật lại dịch vụ...'
  if (-not (Start-QlcnService)) { $exitCode = 1 }
  if ($exitCode -ne 0) { Write-Host 'Khôi phục KHÔNG thành công, dữ liệu hiện tại không bị thay đổi.' -ForegroundColor Red }
  exit $exitCode
}

function Invoke-Doctor {
  $output = & $Node $Main doctor --data-dir $DataRoot
  $output | Write-Host
  $line = $output | Where-Object { "$_" -like 'Đã tạo file chẩn đoán: *' } | Select-Object -Last 1
  if ($line) { & explorer.exe "/select,$(("$line").Substring('Đã tạo file chẩn đoán: '.Length))" }
}

$command = if ($args.Count -gt 0) { $args[0] } else { '' }
$rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

switch ($command) {
  'status' { Show-Status }
  'start' { if (-not (Start-QlcnService)) { exit 1 } }
  'stop' { Stop-QlcnService; Write-Host 'Đã dừng dịch vụ.' }
  'restart' { Stop-QlcnService; if (-not (Start-QlcnService)) { exit 1 } }
  'backup' { exit (Invoke-Main @('backup')) }
  'backups' { Show-Backups }
  'restore' { Invoke-Restore $rest }
  'doctor' { Invoke-Doctor }
  'logs' { & explorer.exe (Join-Path $DataRoot 'logs') }
  'version' { exit (Invoke-Main @('version')) }
  { $_ -in @('', 'help', '-h', '--help') } { Show-Usage }
  default { Write-Host "Không có lệnh `"$command`"." -ForegroundColor Red; Show-Usage; exit 2 }
}
