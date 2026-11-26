<#
  _KonfigJaringan.ps1 - daftar IP / host / subnet jaringan 3 koneksi, DIBACA dari file pengaturan
  (bukan ditulis mati di skrip), supaya kalau IP server berubah cukup edit file JSON-nya.

  Dipakai skrip lain dengan:   . "$PSScriptRoot\_KonfigJaringan.ps1";  $K = Get-KonfigJaringan

  File pengaturan dicari berurutan:
    1. $env:ZEENIQ_JARINGAN_IP            (diset otomatis oleh ZeenIQ Dev Tools)
    2. <folder app>\Data\jaringan-ip.json (= ..\..\Data dari folder skrip ini)
  Kalau tidak ada / rusak -> nilai bawaan di bawah (sama dengan nilai lama di skrip).
  Kunci yang tidak ditulis di file juga memakai nilai bawaan.
#>

function Get-KonfigJaringanBawaan {
    [ordered]@{
        SsidNonCorp           = 'WLAN-NON-CORP'
        GatewayNonCorpCadangan = '10.149.0.1'
        HostDev = @(
            [pscustomobject]@{ IP = '10.239.19.130'; Port = 18002; Nama = 'devbisssapp01';      Hostname = @('devbisssapp01', 'devbisssapp01.corp.bi.go.id') },
            [pscustomobject]@{ IP = '10.239.13.100'; Port = 1521;  Nama = 'devbisssdbo01';      Hostname = @('devbisssdbo01', 'devbisssdbo01.corp.bi.go.id') },
            [pscustomobject]@{ IP = '10.239.14.38';  Port = 1521;  Nama = 'devgmmpdbs01';       Hostname = @('devgmmpdbs01', 'devgmmpdbs01.corp.bi.go.id') },
            [pscustomobject]@{ IP = '10.230.84.29';  Port = 1521;  Nama = 'DEV02';              Hostname = @('DEV02', 'dev02', 'dev02.corp.bi.go.id') },
            [pscustomobject]@{ IP = '10.161.1.82';   Port = 443;   Nama = 'coordinator-impala'; Hostname = @('coordinator-impala.apps.dc1pdaecsr01.corp.bi.go.id') },
            [pscustomobject]@{ IP = '10.161.10.135'; Port = 1521;  Nama = 'dc1sssdb002';        Hostname = @('dc1sssdb002.corp.bi.go.id', 'dc1sssdbo02.corp.bi.go.id', 'sss.corp.bi.go.id') }
        )
        HostAtrust    = [pscustomobject]@{ IP = '10.28.224.213'; Port = 1521; Nama = 'DB via aTrust' }
        SubnetNonCorp = @('10.239.0.0/16', '10.230.0.0/16', '10.161.0.0/16', '10.210.0.0/16', '10.240.0.0/16', '10.149.0.0/16')
        DnsIse        = @('10.210.81.25', '10.210.81.26')
        SubnetIse     = '10.210.0.0/16'
        Timesheet     = [pscustomobject]@{ IP = '10.28.224.55'; Port = 8080; Nama = 'Timesheets'; Url = 'http://10.28.224.55:8080/timesheets' }
        ProbeDev      = [pscustomobject]@{ IP = '10.239.19.130'; Port = 18002; Nama = 'devbisssapp01' }
        # Jalur Internet: Otomatis (Ethernet/tethering USB dulu, kalau tidak ada dongle Wi-Fi) | Ethernet | Dongle
        JalurInternet    = 'Otomatis'
        # Adapter untuk MENYAMBUNGKAN WLAN-NON-CORP: Otomatis (yang bebas, utamakan bawaan) | Bawaan | Dongle
        WifiNonCorpLewat = 'Otomatis'
    }
}

function Get-KonfigJaringanPath {
    if ($env:ZEENIQ_JARINGAN_IP) { return $env:ZEENIQ_JARINGAN_IP }
    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\Data\jaringan-ip.json'))
}

function Get-KonfigJaringan {
    $k = Get-KonfigJaringanBawaan
    $path = Get-KonfigJaringanPath
    if (Test-Path -LiteralPath $path) {
        try {
            $j = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($p in $j.PSObject.Properties) {
                if ($k.Contains($p.Name) -and $null -ne $p.Value) { $k[$p.Name] = $p.Value }
            }
            Write-Host "  [i] Daftar IP dari $path" -ForegroundColor DarkGray
        } catch {
            Write-Host "  [!] $path tidak bisa dibaca ($($_.Exception.Message)) - pakai IP bawaan." -ForegroundColor Yellow
        }
    }
    # array tunggal dari JSON tetap array
    foreach ($n in 'HostDev', 'SubnetNonCorp', 'DnsIse') { $k[$n] = @($k[$n]) }
    return [pscustomobject]$k
}

# "10.210.0.0/16" -> @('10.210.0.0', '255.255.0.0')  (untuk route.exe)
function ConvertTo-PrefixMask([string]$Cidr) {
    $ip, $len = $Cidr -split '/'
    $len = [int]$len
    $mask = [uint32]0; if ($len -gt 0) { $mask = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $len)) }
    $b = [BitConverter]::GetBytes($mask); [array]::Reverse($b)
    return @($ip, ([string]::Join('.', $b)))
}
