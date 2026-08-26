// Wrapper: memanggil adacode via Node.js execSync agar output lengkap (bukan
// dipotong saat stdout bukan TTY). Output yang dipaksa muncul adalah yang sama
// dengan menjalankan "adacode status" di terminal.
const { execSync } = require('child_process');
try {
  // PAKSA --use-system-ca supaya TLS ke api.adacode.ai jalan (server pakai
  // self-signed cert yang gak dikenal Node default).
  const r = execSync('adacode status', {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '--use-system-ca' }
  });
  process.stdout.write(r);
} catch (e) {
  process.stderr.write(e.stderr?.toString() ?? e.message + '\n');
  process.exit(1);
}
