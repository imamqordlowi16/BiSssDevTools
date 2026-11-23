#!/data/data/com.termux/files/usr/bin/bash
# bi-portal-login.sh - login otomatis portal tamu Cisco ISE (WLAN-PUBLIC-BI)
# dari HP Android (Termux). Pasangan Login_Otomatis_MiFi_Portal.ps1 di laptop.
#
# Pakai:
#   bash bi-portal-login.sh --simpan     simpan username/password (diketik, tidak tampil)
#   bash bi-portal-login.sh              cek & login bila sesi portal habis
#   DRYRUN=1 bash bi-portal-login.sh     cek + baca form portal, login TIDAK dikirim
# Opsional: IFACE=<ip-wifi> (bind sumber), PORTAL_URL=<url> (paksa, untuk uji).
#
# PENTING: matikan Data Seluler saat Wi-Fi ini dipakai - selama portal menahan,
# Android memindah internet ke data seluler sehingga cek "online" menipu.
set -u
CRED="$HOME/.bi-portal.cred"
LOG="$HOME/bi-portal-login.log"
UA='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'
PROBE='http://connectivitycheck.gstatic.com/generate_204'

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

if [ "${1:-}" = "--simpan" ]; then
  read -r -p 'Username portal: ' u
  read -r -s -p 'Password portal: ' p; echo
  umask 077
  printf '%s\n%s\n' "$u" "$p" > "$CRED"
  chmod 600 "$CRED"
  echo "Tersimpan di $CRED (hanya bisa dibaca Termux)."
  exit 0
fi

# Satu instance (cron tiap 2 menit bisa tumpang tindih).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$HOME/.bi-portal.lock"
  flock -n 9 || exit 0
fi

# Log dipangkas > 512 KB.
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 524288 ] && tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
c() { curl -s -k -m 20 ${IFACE:+--interface "$IFACE"} -A "$UA" -c "$JAR" -b "$JAR" "$@"; }
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

url="${PORTAL_URL:-}"
if [ -z "$url" ]; then
  r=$(c -i "$PROBE")
  if printf '%s' "$r" | head -1 | grep -q ' 204'; then
    [ -n "${DRYRUN:-}" ] && log "[OK] online - sesi portal masih berlaku"
    exit 0
  fi
  url=$(printf '%s' "$r" | tr -d '\r' | sed -n 's/^[Ll]ocation: *//p' | grep '/portal/gateway' | head -1)
  [ -z "$url" ] && url=$(printf '%s' "$r" | grep -o 'URL=https://[^"]*/portal/gateway[^"]*' | head -1 | cut -c5- | sed 's/&amp;/\&/g')
  if [ -z "$url" ]; then
    log "[GAGAL] tidak online & tidak ada redirect portal ISE (Wi-Fi belum tersambung?)"
    exit 2
  fi
fi
log "sesi portal habis -> ${url%%\?*}"

page=$(c -L -w '__URL__%{url_effective}' "$url")
eff=${page##*__URL__}
origin=$(printf '%s' "$eff" | grep -o '^https://[^/]*')
token=$(printf '%s' "$page" | grep -o 'name="token" value="[^"]*"' | head -1 | cut -d'"' -f4)
portal=$(printf '%s' "$page" | grep -o 'name="portal" value="[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$origin" ] || [ -z "$token" ] || ! printf '%s' "$page" | grep -q 'LoginSubmit.action'; then
  log "[GAGAL] form login portal tidak ditemukan"
  exit 3
fi
if [ -n "${DRYRUN:-}" ]; then
  log "[OK] DryRun: form login ditemukan (token ${token:0:6}..., portal $portal) - login TIDAK dikirim"
  exit 0
fi

[ -f "$CRED" ] || { log "[GAGAL] kredensial belum disimpan - jalankan: bash $0 --simpan"; exit 4; }
{ IFS= read -r u; IFS= read -r p; } < "$CRED"
# Kredensial lewat stdin (-K -), tidak muncul di daftar proses.
resp=$(printf 'data-urlencode = "user.username=%s"\ndata-urlencode = "user.password=%s"\ndata-urlencode = "token=%s"\ndata-urlencode = "portal=%s"\n' \
        "$(esc "$u")" "$(esc "$p")" "$(esc "$token")" "$(esc "$portal")" \
      | c -L -K - "$origin/portal/LoginSubmit.action?from=LOGIN")
unset u p

sleep 5
if c -i "$PROBE" | head -1 | grep -q ' 204'; then
  log "[OK] login portal BERHASIL"
else
  msg=$(printf '%s' "$resp" | grep -o -i 'class="[^"]*error[^"]*"[^>]*>[^<]*' | head -1 | sed 's/.*>//')
  log "[GAGAL] login dikirim tapi masih ditahan portal. ${msg:-Cek username/password (--simpan lagi).}"
  exit 5
fi
