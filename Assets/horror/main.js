// MALAM TERAKHIR - game horor 3D first-person (tab 🎃 Horor ZeenIQ Dev Tools).
//
// Mode: solo, co-op (2-4, hantu AI), versus (2-4, satu pemain jadi hantu).
// Kesulitan: mudah / sedang / sulit / sangat sulit. Hantu: 5 jenis (acak atau pilih).
// Jaringan lewat C# (Horror/HorrorGameView.cs): game ini mengirim {cmd} ke C# dan
// menerima {ev}. Host = wasit: AI hantu, item, siapa tertangkap, kapan selesai.
// Semua yang acak (item, catatan, posisi awal hantu, isi laci) diturunkan dari satu
// seed yang dikirim host, jadi sama persis di semua komputer.
// Ringan: MeshLambert, tanpa bayangan, InstancedMesh, jumlah lampu tetap & kecil,
// tekstur kecil (128px) digambar di kode, kabut menutup jarak pandang.
import * as THREE from './lib/three.module.min.js';
import { MAPS, SOLID, BLOCKS_SIGHT, reachable } from './maps.js';
import { Sfx } from './audio.js';

// ======================= UTIL =======================
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const CELL = 2, WALL_H = 3, EYE = 1.6, GHOST_EYE = 2.0, PR = 0.3, INTRO = 16;
const COLORS = [0x3a7bd5, 0xd53a3a, 0x3ad57b, 0xd5b83a];
const MODE_NAME = { solo: 'Solo', coop: 'Co-op', versus: 'Versus' };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const store = {
  get(k, d) { try { const v = localStorage.getItem('mt.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mt.' + k, JSON.stringify(v)); } catch { } },
};
function cleanName(s) { s = (s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14); return s || 'Pemain'; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ======================= KESULITAN & JENIS HANTU =======================
const DIFF = {
  mudah: { name: 'Mudah', desc: '2 nyawa, hantu lambat, baterai awet', speed: 0.8, sight: 0.75, hear: 0.7, grace: 14, battery: 320, items: 3, lives: 2, loot: 0.35 },
  sedang: { name: 'Sedang', desc: 'Seimbang', speed: 1.0, sight: 1.0, hear: 1.0, grace: 9, battery: 220, items: 3, lives: 1, loot: 0.25 },
  sulit: { name: 'Sulit', desc: 'Hantu lebih cepat & tajam, 4 item', speed: 1.15, sight: 1.25, hear: 1.3, grace: 6, battery: 150, items: 4, lives: 1, loot: 0.18 },
  ekstrem: { name: 'Sangat Sulit', desc: '5 item, baterai cepat habis', speed: 1.3, sight: 1.5, hear: 1.6, grace: 4, battery: 100, items: 5, lives: 1, loot: 0.1 },
};
const GHOSTS = {
  kunti: { name: 'Kuntilanak', desc: 'Wanita bergaun putih. Tawanya tanda dia dekat.', wander: 1.0, chase: 1.0, give: 6 },
  pocong: { name: 'Pocong', desc: 'Melompat-lompat, dan bisa berpindah tempat saat tidak dilihat.', wander: 0.85, chase: 0.85, give: 7 },
  genderuwo: { name: 'Genderuwo', desc: 'Raksasa berbulu. Lambat berjalan, sangat cepat saat mengejar. Langkahnya terdengar.', wander: 0.75, chase: 1.25, give: 6 },
  anak: { name: 'Anak Pucat', desc: 'Kecil dan cepat, tapi cepat bosan mengejar.', wander: 1.25, chase: 1.2, give: 2.5 },
  bayangan: { name: 'Sosok Bayangan', desc: 'Hampir tak terlihat dalam gelap. Hanya jelas saat disorot senter.', wander: 1.0, chase: 1.0, give: 6 },
};
const GHOST_KEYS = Object.keys(GHOSTS);
const STATE_CODE = { idle: 0, wander: 0, chase: 1, search: 2, gone: 3 };

// ======================= JEMBATAN KE C# =======================
const hasBridge = !!(window.chrome && window.chrome.webview);
function bridge(cmd) { if (hasBridge) { try { window.chrome.webview.postMessage(cmd); } catch { } } }
function sendAll(data) { if (G.role === 'host') bridge({ cmd: 'send', to: -1, data }); }
function sendTo(id, data) { if (G.role === 'host') bridge({ cmd: 'send', to: id, data }); }
function sendHost(data) { if (G.role === 'client') bridge({ cmd: 'send', to: 0, data }); }
if (hasBridge) window.chrome.webview.addEventListener('message', (e) => onBridge(e.data));

// ======================= PENGATURAN =======================
const settings = {
  name: store.get('name', ''),
  quality: store.get('quality', 'med'),
  volume: store.get('volume', 80),
  sens: store.get('sens', 12),
  mode: store.get('mode', 'solo'),
  map: store.get('map', 0),
  diff: store.get('diff', 'sedang'),
  gtype: store.get('gtype', 'acak'),
};
if (!DIFF[settings.diff]) settings.diff = 'sedang';
if (settings.gtype !== 'acak' && !GHOSTS[settings.gtype]) settings.gtype = 'acak';
const Q = {
  low: { scale: 0.5, lights: 2, aa: false, far: 26, remoteSpots: false },
  med: { scale: 0.75, lights: 4, aa: false, far: 34, remoteSpots: false },
  high: { scale: 1.0, lights: 6, aa: true, far: 44, remoteSpots: true },
}[settings.quality] || { scale: 0.75, lights: 4, aa: false, far: 34, remoteSpots: false };

const sfx = new Sfx();
sfx.setVolume(settings.volume / 100);

// ======================= RENDERER =======================
const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, powerPreference: 'default' });
renderer.setPixelRatio(Q.scale * Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, Q.far);
camera.rotation.order = 'YXZ';
scene.add(camera);
const hemi = new THREE.HemisphereLight(0x303040, 0x080808, 0.4);
scene.add(hemi);

// Senter: selalu ada di scene (intensitas 0 saat mati) supaya shader tidak dikompilasi ulang.
const flash = new THREE.SpotLight(0xfff0d8, 0, 20, 0.5, 0.55, 1.4);
flash.position.set(0.15, -0.1, 0);
flash.target.position.set(0, -0.05, -1);
camera.add(flash, flash.target);

// Lampu langit-langit: kolam lampu tetap, dipindah ke lampu terdekat.
const lampPool = [];
for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight(0xffffff, 0, 9, 1.6); scene.add(l); lampPool.push(l); }
const remoteSpots = [];
if (Q.remoteSpots) for (let i = 0; i < 3; i++) { const s = new THREE.SpotLight(0xfff0d8, 0, 16, 0.45, 0.5, 1.4); scene.add(s, s.target); remoteSpots.push(s); }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ======================= TEKSTUR (digambar di kode) =======================
function canvasTex(draw, size = 128, rep = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep[0], rep[1]);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g, s, n, color, r, alpha, rand) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) { g.globalAlpha = alpha * rand(); g.fillRect(rand() * s, rand() * s, r * rand() + 1, r * rand() + 1); }
  g.globalAlpha = 1;
}
function stains(g, s, n, rand, color = '#000') {
  for (let i = 0; i < n; i++) {
    const x = rand() * s, y = rand() * s, r = 6 + rand() * 18;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.25 + rand() * 0.3; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
}
function wallTexture(map) {
  const p = map.palette, rand = rng(11);
  return canvasTex((g, s) => {
    g.fillStyle = p.wall; g.fillRect(0, 0, s, s);
    switch (map.wall) {
      case 'wallpaper':
        for (let x = 0; x < s; x += 16) { g.fillStyle = p.wall2; g.fillRect(x, 0, 6, s); }
        for (let y = 8; y < s * 0.7; y += 20) for (let x = 8; x < s; x += 16) { g.fillStyle = 'rgba(120,90,70,.25)'; g.fillRect(x - 2, y - 2, 4, 4); }
        g.fillStyle = '#1e1410'; g.fillRect(0, s * 0.72, s, s * 0.28);
        g.fillStyle = '#2c1e16'; g.fillRect(0, s * 0.72, s, 3);
        stains(g, s, 6, rand, '#0a0604');
        break;
      case 'tiles':
        for (let y = 0; y < s; y += 16) for (let x = 0; x < s; x += 16) { g.fillStyle = (x + y) % 32 ? p.wall : p.wall2; g.fillRect(x + 1, y + 1, 14, 14); }
        g.fillStyle = 'rgba(0,0,0,.35)';
        for (let i = 0; i <= s; i += 16) { g.fillRect(i, 0, 1, s); g.fillRect(0, i, s, 1); }
        stains(g, s, 5, rand, '#3a1a08');
        break;
      case 'school':
        g.fillStyle = p.wall2; g.fillRect(0, s * 0.55, s, s * 0.45);
        g.fillStyle = '#1c2a20'; g.fillRect(0, s * 0.55, s, 4);
        speckle(g, s, 140, '#000', 3, 0.25, rand);
        stains(g, s, 4, rand);
        break;
      case 'panel':
        for (let x = 0; x < s; x += 32) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, 0, 2, s); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 2, 0, 1, s); }
        g.fillStyle = '#20242c'; g.fillRect(0, s * 0.9, s, s * 0.1);
        speckle(g, s, 80, '#000', 2, 0.2, rand);
        break;
    }
  });
}
function floorTexture(map, w, h) {
  const p = map.palette, rand = rng(7);
  return canvasTex((g, s) => {
    g.fillStyle = p.floor; g.fillRect(0, 0, s, s);
    switch (map.floor) {
      case 'wood':
        for (let y = 0; y < s; y += 16) {
          g.fillStyle = rand() > 0.5 ? p.floor : p.floor2; g.fillRect(0, y, s, 15);
          g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + 15, s, 1);
          const o = (y / 16 % 2) * 40; g.fillRect((o + 30) % s, y, 1, 15); g.fillRect((o + 94) % s, y, 1, 15);
        }
        speckle(g, s, 120, '#000', 3, 0.3, rand);
        break;
      case 'checker':
        for (let y = 0; y < s; y += 32) for (let x = 0; x < s; x += 32) { g.fillStyle = ((x + y) / 32) % 2 ? p.floor2 : p.floor; g.fillRect(x, y, 32, 32); }
        stains(g, s, 5, rand, '#200');
        break;
      case 'lino':
        speckle(g, s, 500, p.floor2, 2, 0.8, rand);
        speckle(g, s, 200, '#000', 2, 0.3, rand);
        break;
      case 'carpet':
        speckle(g, s, 900, p.floor2, 2, 0.9, rand);
        speckle(g, s, 300, '#000', 2, 0.25, rand);
        break;
    }
    stains(g, s, 3, rand);
  }, 128, [w, h]);
}
const glowCache = {};
function glowTexture(color) {
  return glowCache[color] ??= canvasTex((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, color); gr.addColorStop(0.35, color.replace('1)', '.35)')); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }, 64);
}
function textTexture(text, fg, bg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg; g.font = 'bold 40px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ======================= MODEL HANTU (5 jenis) =======================
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
function mesh(geom, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); return m; }
function makeGhostModel(type = 'kunti') {
  const g = new THREE.Group();
  const arms = [];
  const eyeRed = basic(0xff2020, { fog: false });
  switch (type) {
    case 'pocong': {
      const cloth = lambert(0xd8d4c8, { emissive: 0x151515 });
      const tie = lambert(0x9a968c);
      const body = mesh(new THREE.CapsuleGeometry(0.27, 1.35, 4, 10), cloth, 0, 0.95, 0); g.add(body);
      for (const y of [0.35, 1.0, 1.62]) { const r = mesh(new THREE.TorusGeometry(0.27, 0.025, 4, 12), tie, 0, y, 0); r.rotation.x = Math.PI / 2; g.add(r); }
      g.add(mesh(new THREE.ConeGeometry(0.09, 0.28, 6), cloth, 0, 2.0, 0));
      g.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), tie, 0, 1.86, 0));
      const hole = mesh(new THREE.SphereGeometry(0.15, 10, 8), basic(0x120c08), 0, 1.5, 0.17); hole.scale.set(1, 1.25, 0.45); g.add(hole);
      const face = mesh(new THREE.SphereGeometry(0.11, 8, 6), lambert(0x6e675a), 0, 1.5, 0.2); face.scale.set(1, 1.2, 0.5); g.add(face);
      for (const x of [-0.04, 0.04]) g.add(mesh(new THREE.SphereGeometry(0.018, 5, 4), basic(0xffffff, { fog: false }), x, 1.53, 0.26));
      g.userData.head = { y: 1.5, z: 0.25, r: 0.1 };
      break;
    }
    case 'genderuwo': {
      const fur = lambert(0x2a1a10, { flatShading: true });
      const body = mesh(new THREE.IcosahedronGeometry(0.7, 1), fur, 0, 1.4, 0); body.scale.set(1, 1.35, 0.8); g.add(body);
      g.add(mesh(new THREE.IcosahedronGeometry(0.33, 1), fur, 0, 2.45, 0.1));
      for (const x of [-0.28, 0.28]) g.add(mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.75, 6), fur, x, 0.38, 0));
      for (const x of [-0.08, 0.08]) g.add(mesh(new THREE.SphereGeometry(0.05, 6, 4), eyeRed, x * 1.3, 2.5, 0.38));
      for (const x of [-0.08, 0.08]) { const f = mesh(new THREE.ConeGeometry(0.03, 0.12, 4), basic(0xe8e0c8), x, 2.32, 0.38); f.rotation.x = Math.PI; g.add(f); }
      for (const x of [-0.75, 0.75]) {
        const a = new THREE.Group(); a.position.set(x, 2.0, 0);
        a.add(mesh(new THREE.CylinderGeometry(0.12, 0.09, 1.4, 6), fur, 0, -0.7, 0));
        a.rotation.x = -0.4; g.add(a); arms.push(a);
      }
      g.userData.head = { y: 2.45, z: 0.44, r: 0.24 };
      break;
    }
    case 'anak': {
      const shirt = lambert(0x8a8a80), skin = lambert(0xd0ccc4, { emissive: 0x1a1a1a }), hair = lambert(0x050505);
      g.add(mesh(new THREE.CapsuleGeometry(0.17, 0.42, 3, 8), shirt, 0, 0.62, 0));
      for (const x of [-0.08, 0.08]) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 5), skin, x, 0.18, 0));
      g.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), skin, 0, 1.08, 0));
      const cap = mesh(new THREE.SphereGeometry(0.215, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 1.1, -0.02); g.add(cap);
      for (const x of [-0.07, 0.07]) { const e = mesh(new THREE.SphereGeometry(0.05, 6, 5), basic(0x000000), x, 1.08, 0.16); e.scale.z = 0.5; g.add(e); }
      for (const x of [-0.22, 0.22]) {
        const a = new THREE.Group(); a.position.set(x, 0.85, 0);
        a.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.45, 5), skin, 0, -0.22, 0));
        a.rotation.x = -0.3; g.add(a); arms.push(a);
      }
      g.userData.head = { y: 1.08, z: 0.215, r: 0.16 };
      break;
    }
    case 'bayangan': {
      const dark = basic(0x000000, { transparent: true, opacity: 0.92 });
      g.add(mesh(new THREE.CapsuleGeometry(0.2, 1.7, 3, 8), dark, 0, 1.15, 0));
      const head = mesh(new THREE.SphereGeometry(0.17, 8, 6), dark, 0, 2.2, 0); head.scale.y = 1.25; g.add(head);
      for (const x of [-0.06, 0.06]) g.add(mesh(new THREE.SphereGeometry(0.022, 5, 4), basic(0xf0f0ff, { fog: false, transparent: true }), x, 2.23, 0.15));
      for (const x of [-0.24, 0.24]) {
        const a = new THREE.Group(); a.position.set(x, 1.95, 0);
        a.add(mesh(new THREE.CylinderGeometry(0.03, 0.02, 1.25, 4), dark, 0, -0.62, 0));
        a.rotation.x = -0.2; g.add(a); arms.push(a);
      }
      g.userData.shadow = true;
      g.userData.head = { y: 2.2, z: 0.2, r: 0.15 };
      break;
    }
    default: { // kuntilanak
      const dressMat = lambert(0xcfc8bb, { side: THREE.DoubleSide, emissive: 0x141414 });
      const skin = lambert(0xd8d0c4, { emissive: 0x1a1a1a });
      const hair = lambert(0x050505, { side: THREE.DoubleSide });
      g.add(mesh(new THREE.CylinderGeometry(0.17, 0.6, 1.55, 9, 1, true), dressMat, 0, 0.95, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.5, 8), dressMat, 0, 1.8, 0));
      const head = mesh(new THREE.SphereGeometry(0.16, 10, 8), skin, 0, 2.17, 0.02); head.scale.set(0.9, 1.2, 0.95); g.add(head);
      const back = mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.1, 10, 1, true, Math.PI * 0.15, Math.PI * 1.7), hair, 0, 1.85, 0); back.rotation.y = Math.PI; g.add(back);
      for (let i = -2; i <= 2; i++) g.add(mesh(new THREE.BoxGeometry(0.05, 0.75 + Math.abs(i) * 0.1, 0.02), hair, i * 0.06, 1.95, 0.16));
      for (const x of [-0.06, 0.06]) g.add(mesh(new THREE.SphereGeometry(0.022, 6, 4), eyeRed, x, 2.2, 0.15));
      for (const x of [-0.22, 0.22]) {
        const a = new THREE.Group(); a.position.set(x, 1.95, 0);
        a.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.95, 5), skin, 0, -0.47, 0));
        a.add(mesh(new THREE.BoxGeometry(0.07, 0.16, 0.04), skin, 0, -1.0, 0));
        a.rotation.x = -1.0; g.add(a); arms.push(a);
      }
      g.userData.head = { y: 2.17, z: 0.19, r: 0.135 };
    }
  }
  g.userData.arms = arms;
  g.userData.type = type;
  return g;
}
function setGhostOpacity(model, o) {
  model.traverse(m => { if (m.material && m.material.transparent) m.material.opacity = m.material.color.getHex() === 0 ? 0.92 * o : o; });
}
function makeAvatar(color, name) {
  const g = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(0.24, 0.85, 3, 8), lambert(color), 0, 0.85, 0); g.add(body);
  g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), lambert(0xd9b38c), 0, 1.6, 0));
  const torch = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 6), lambert(0x222222), 0.25, 1.2, -0.25);
  torch.rotation.x = Math.PI / 2; g.add(torch);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,240,210,1)'), blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(0.6, 0.6, 1); glow.position.set(0.25, 1.2, -0.38); g.add(glow);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(name, '#fff', 'rgba(0,0,0,.55)'), depthTest: false, fog: false }));
  tag.scale.set(1.0, 0.25, 1); tag.position.y = 2.05; g.add(tag);
  g.userData.glow = glow;
  g.userData.head = { y: 1.6, z: -0.172, r: 0.15, flip: true }; // avatar menghadap -z
  return g;
}
function makeItemModel(kind) {
  const g = new THREE.Group();
  const gold = basic(kind === 'oldkey' ? 0xd8a640 : kind === 'key' ? 0xcfd6dc : kind === 'card' ? 0x7ad0ff : 0xff9a3a);
  if (kind === 'card') {
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), gold));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.025, 0.04), basic(0x111111), 0, 0, 0.05));
  } else if (kind === 'fuse') {
    const glass = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8), gold); glass.rotation.z = Math.PI / 2; g.add(glass);
    for (const x of [-0.13, 0.13]) { const cap = mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 8), basic(0x999999), x); cap.rotation.z = Math.PI / 2; g.add(cap); }
  } else {
    g.add(mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), gold, -0.12));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.03, 0.03), gold, 0.04));
    for (const x of [0.1, 0.14]) g.add(mesh(new THREE.BoxGeometry(0.02, 0.06, 0.03), gold, x, -0.04, 0));
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,210,120,1)'), blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(0.9, 0.9, 1); g.add(halo);
  return g;
}
function makeNoteModel() {
  const g = new THREE.Group();
  const paper = mesh(new THREE.PlaneGeometry(0.28, 0.36), lambert(0xe8dcc0, { emissive: 0x2a2418, side: THREE.DoubleSide }));
  paper.rotation.x = -Math.PI / 2; g.add(paper);
  for (let i = 0; i < 4; i++) { const l = mesh(new THREE.PlaneGeometry(0.2, 0.012), basic(0x3a2a1a)); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.002, -0.1 + i * 0.06); g.add(l); }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,245,220,1)'), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
  halo.scale.set(0.6, 0.6, 1); halo.position.y = 0.05; g.add(halo);
  return g;
}

// ======================= DUNIA =======================
const W = { group: null, grid: [], w: 0, h: 0, map: null, lamps: [], items: [], notes: [], exit: null, doorMesh: null, sign: null, signOpen: null, signClosed: null, lampMesh: null, walk: [], exitInward: [0, 0] };

function tileAt(cx, cz) { return (cx < 0 || cz < 0 || cx >= W.w || cz >= W.h) ? '#' : W.grid[cz][cx]; }
const isWall = (cx, cz) => { const t = tileAt(cx, cz); return t === '#' || t === 'X'; };
// arah membelakangi dinding terdekat (lemari/ranjang menempel ke dinding)
function faceFromWall(cx, cz) {
  if (isWall(cx, cz - 1)) return 0;
  if (isWall(cx, cz + 1)) return Math.PI;
  if (isWall(cx - 1, cz)) return Math.PI / 2;
  if (isWall(cx + 1, cz)) return -Math.PI / 2;
  return 0;
}
function solidAt(cx, cz) { const ch = tileAt(cx, cz); return ch === 'X' ? !G.exitOpen : SOLID.has(ch); }
const cellOf = (v) => Math.floor(v / CELL);
const center = (c) => c * CELL + CELL / 2;
function collides(x, z, r) {
  const c0 = cellOf(x - r - 0.01), c1 = cellOf(x + r + 0.01), r0 = cellOf(z - r - 0.01), r1 = cellOf(z + r + 0.01);
  for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
    if (!solidAt(cx, cz)) continue;
    const ch = tileAt(cx, cz);
    const inset = ch === '#' || ch === 'X' ? 0 : 0.25;
    const nx = clamp(x, cx * CELL + inset, (cx + 1) * CELL - inset), nz = clamp(z, cz * CELL + inset, (cz + 1) * CELL - inset);
    if ((x - nx) ** 2 + (z - nz) ** 2 < r * r) return true;
  }
  return false;
}
function lineOfSight(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.3);
  for (let i = 1; i < n; i++) {
    const t = i / n, ch = tileAt(cellOf(lerp(x0, x1, t)), cellOf(lerp(z0, z1, t)));
    if (BLOCKS_SIGHT.has(ch) || (ch === 'X' && !G.exitOpen)) return false;
  }
  return true;
}
function bfsPath(fx, fz, tx, tz) {
  if (fx === tx && fz === tz) return [];
  const w = W.w, prev = new Int32Array(W.w * W.h).fill(-1), start = fz * w + fx, goal = tz * w + tx;
  if (start < 0 || goal < 0 || start >= prev.length || goal >= prev.length) return null;
  prev[start] = start;
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi];
    if (k === goal) break;
    const x = k % w, z = (k / w) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (solidAt(nx, nz) || tileAt(nx, nz) === 'X') continue;
      const nk = nz * w + nx;
      if (prev[nk] !== -1) continue;
      prev[nk] = k; q.push(nk);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let k = goal; k !== start; k = prev[k]) path.push([k % w, (k / w) | 0]);
  return path.reverse();
}
function findCell(ch) { for (let z = 0; z < W.h; z++) for (let x = 0; x < W.w; x++) if (W.grid[z][x] === ch) return [x, z]; return [1, 1]; }

function buildWorld(mapIdx, diffKey = 'sedang') {
  if (W.group) { scene.remove(W.group); W.group.traverse(o => { o.geometry?.dispose(); }); }
  const map = MAPS[mapIdx];
  W.map = map; W.grid = map.grid; W.w = map.grid[0].length; W.h = map.grid.length;
  W.group = new THREE.Group(); scene.add(W.group);
  W.lamps = []; W.items = []; W.notes = [];
  scene.fog = new THREE.FogExp2(map.fog, map.fogDensity * (settings.quality === 'low' ? 1.25 : 1));
  hemi.color.set(map.ambient[0]); hemi.groundColor.set(map.ambient[1]); hemi.intensity = map.ambient[2];
  const p = map.palette;
  const wallMat = lambert(0xffffff, { map: wallTexture(map) });
  const sizeX = W.w * CELL, sizeZ = W.h * CELL;
  const floor = mesh(new THREE.PlaneGeometry(sizeX, sizeZ), lambert(0xffffff, { map: floorTexture(map, W.w, W.h) }), sizeX / 2, 0, sizeZ / 2);
  floor.rotation.x = -Math.PI / 2; W.group.add(floor);
  const ceil = mesh(new THREE.PlaneGeometry(sizeX, sizeZ), lambert(map.ceiling), sizeX / 2, WALL_H, sizeZ / 2);
  ceil.rotation.x = Math.PI / 2; W.group.add(ceil);

  const parts = new Map();
  const mats = {
    wall: wallMat, prop: lambert(p.prop), prop2: lambert(p.prop2), metal: lambert(p.metal),
    sheet: lambert(map.id === 'rs' ? 0xc8ccc8 : 0x8a8270), dark: lambert(0x0c0c0c),
    locker: lambert(map.id === 'rumah' ? 0x2a1c12 : p.metal),
  };
  const geoms = {};
  const box = (w, h, d) => geoms[`b${w},${h},${d}`] ??= new THREE.BoxGeometry(w, h, d);
  const tmp = new THREE.Object3D();
  function put(geom, mat, x, y, z, ry = 0) {
    const key = geom.uuid + mat.uuid;
    if (!parts.has(key)) parts.set(key, { geom, mat, list: [] });
    tmp.position.set(x, y, z); tmp.rotation.set(0, ry, 0); tmp.updateMatrix();
    parts.get(key).list.push(tmp.matrix.clone());
  }
  function putLocal(geom, mat, cx, cz, ry, lx, ly, lz) {
    const c = Math.cos(ry), s = Math.sin(ry);
    put(geom, mat, center(cx) + lx * c + lz * s, ly, center(cz) - lx * s + lz * c, ry);
  }
  // lampu rusak lebih banyak di kesulitan tinggi
  const brokenChance = { mudah: 0.2, sedang: 0.35, sulit: 0.5, ekstrem: 0.65 }[diffKey] ?? 0.35;
  const r = rng(mapIdx * 97 + 5);
  for (let cz = 0; cz < W.h; cz++) for (let cx = 0; cx < W.w; cx++) {
    const ch = W.grid[cz][cx];
    const x = center(cx), z = center(cz);
    switch (ch) {
      case '#': put(box(CELL, WALL_H, CELL), mats.wall, x, WALL_H / 2, z); break;
      case 'D': {
        put(box(CELL, 0.6, CELL), mats.wall, x, WALL_H - 0.3, z);
        const alongX = isWall(cx, cz - 1) && isWall(cx, cz + 1);
        const ry = alongX ? Math.PI / 2 : 0;
        putLocal(box(0.12, 2.4, 0.3), mats.prop, cx, cz, ry, -0.94, 1.2, 0);
        putLocal(box(0.12, 2.4, 0.3), mats.prop, cx, cz, ry, 0.94, 1.2, 0);
        if (map.id !== 'kantor' && r() < 0.8) putLocal(box(0.06, 2.3, 0.9), mats.prop, cx, cz, ry, -0.9, 1.15, 0.5);
        break;
      }
      case 'B': {
        const ry = faceFromWall(cx, cz);
        putLocal(box(1.0, 0.35, 1.9), map.id === 'rs' ? mats.metal : mats.prop, cx, cz, ry, 0, 0.35, 0.05);
        putLocal(box(0.96, 0.14, 1.84), mats.sheet, cx, cz, ry, 0, 0.6, 0.05);
        putLocal(box(0.7, 0.12, 0.35), mats.sheet, cx, cz, ry, 0, 0.73, -0.68);
        putLocal(box(1.0, 1.0, 0.08), map.id === 'rs' ? mats.metal : mats.prop, cx, cz, ry, 0, 0.5, -0.9);
        break;
      }
      case 'T': {
        const ry = (map.id === 'sekolah' || map.id === 'kantor') ? 0 : r() * 0.3;
        putLocal(box(1.5, 0.07, 0.85), mats.prop, cx, cz, ry, 0, 0.76, 0);
        for (const [lx, lz] of [[-0.68, -0.36], [0.68, -0.36], [-0.68, 0.36], [0.68, 0.36]]) putLocal(box(0.06, 0.72, 0.06), mats.metal, cx, cz, ry, lx, 0.36, lz);
        putLocal(box(0.5, 0.18, 0.6), mats.prop2, cx, cz, ry, 0.35, 0.6, 0); // laci
        if (map.id === 'kantor') { putLocal(box(0.5, 0.35, 0.05), mats.dark, cx, cz, ry, 0, 1.0, -0.2); putLocal(box(0.5, 0.33, 0.02), mats.prop2, cx, cz, ry, 0, 1.0, -0.17); }
        if (map.id === 'sekolah') putLocal(box(0.45, 0.04, 0.45), mats.prop, cx, cz, ry, 0, 0.45, 0.7);
        break;
      }
      case 'C': {
        const ry = faceFromWall(cx, cz);
        putLocal(box(1.4, 2.0, 0.55), mats.prop, cx, cz, ry, 0, 1.0, -0.6);
        for (const y of [0.5, 1.0, 1.5]) putLocal(box(1.3, 0.05, 0.5), mats.prop2, cx, cz, ry, 0, y, -0.55);
        break;
      }
      case 'H': {
        const ry = faceFromWall(cx, cz);
        putLocal(box(1.1, 2.25, 0.8), mats.locker, cx, cz, ry, 0, 1.125, -0.45);
        putLocal(box(0.03, 2.05, 0.02), mats.dark, cx, cz, ry, 0, 1.1, -0.04);
        for (const lx of [-0.08, 0.08]) putLocal(box(0.03, 0.18, 0.04), mats.metal, cx, cz, ry, lx, 1.15, -0.02);
        for (let i = 0; i < 4; i++) putLocal(box(0.35, 0.02, 0.02), mats.dark, cx, cz, ry, -0.3, 1.9 - i * 0.06, -0.04);
        break;
      }
      case 'c': {
        const ry = r() * Math.PI * 2;
        putLocal(box(0.45, 0.05, 0.45), mats.prop, cx, cz, ry, 0, 0.45, 0);
        putLocal(box(0.45, 0.5, 0.05), mats.prop, cx, cz, ry, 0, 0.72, -0.2);
        for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) putLocal(box(0.04, 0.45, 0.04), mats.metal, cx, cz, ry, lx, 0.22, lz);
        break;
      }
      case 'L': W.lamps.push({ x, z, cx, cz, broken: r() < brokenChance, phase: r() * 100, level: 1, flickerT: 0 }); break;
      case 'X': W.exit = { cx, cz }; break;
    }
  }
  for (const { geom, mat, list } of parts.values()) {
    const m = new THREE.InstancedMesh(geom, mat, list.length);
    list.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    W.group.add(m);
  }
  W.lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.06, 0.7), basic(0xffffff), Math.max(1, W.lamps.length));
  W.lamps.forEach((l, i) => { tmp.position.set(l.x, WALL_H - 0.03, l.z); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); W.lampMesh.setMatrixAt(i, tmp.matrix); W.lampMesh.setColorAt(i, new THREE.Color(map.lamp)); });
  W.lampMesh.count = W.lamps.length;
  W.group.add(W.lampMesh);
  lampPool.forEach(l => l.color.set(map.lamp));

  // pintu keluar
  const ex = W.exit;
  const exX = center(ex.cx), exZ = center(ex.cz);
  const inward = ex.cz === W.h - 1 ? -1 : ex.cz === 0 ? 1 : 0;
  const inwardX = ex.cx === W.w - 1 ? -1 : ex.cx === 0 ? 1 : 0;
  const exRy = inwardX ? Math.PI / 2 : 0;
  W.exitInward = [inwardX, inward];
  W.group.add(mesh(box(CELL, 0.5, CELL), wallMat, exX, WALL_H - 0.25, exZ));
  for (const s of [-1, 1]) { const post = mesh(box(0.25, 2.5, CELL), wallMat, exX + (exRy ? 0 : s * 0.88), 1.25, exZ + (exRy ? s * 0.88 : 0)); post.rotation.y = exRy; W.group.add(post); }
  const outside = mesh(new THREE.PlaneGeometry(1.6, 2.5), basic(0x8a9ab8, { fog: false }), exX - inwardX * 0.95, 1.25, exZ - inward * 0.95);
  outside.rotation.y = inwardX ? Math.PI / 2 * inwardX : (inward < 0 ? 0 : Math.PI); W.group.add(outside);
  W.doorMesh = mesh(new THREE.BoxGeometry(1.5, 2.5, 0.1), lambert(0x4a1010), exX + inwardX * 0.6, 1.25, exZ + inward * 0.6);
  W.doorMesh.rotation.y = exRy; W.group.add(W.doorMesh);
  W.signClosed ??= textTexture('TERKUNCI', '#ff3030', '#1a0000');
  W.signOpen ??= textTexture('KELUAR', '#30ff60', '#001a06');
  W.sign = mesh(new THREE.PlaneGeometry(0.9, 0.22), basic(0xffffff, { map: W.signClosed, fog: false }), exX + inwardX * 0.99, 2.75, exZ + inward * 0.99);
  W.sign.rotation.y = inwardX ? -Math.PI / 2 * inwardX : (inward < 0 ? 0 : Math.PI);
  W.group.add(W.sign);

  const reach = reachable(W.grid, false);
  W.walk = [...reach].map(k => [k % W.w, (k / W.w) | 0]).filter(([x, z]) => !'SX'.includes(W.grid[z][x]));
}

// lokasi dalam kata-kata, untuk petunjuk di catatan
function describe(cx, cz) {
  const ns = cz < W.h / 3 ? 'utara' : cz >= (2 * W.h) / 3 ? 'selatan' : '';
  const ew = cx < W.w / 3 ? 'barat' : cx >= (2 * W.w) / 3 ? 'timur' : '';
  const area = ns || ew ? `bagian ${[ns, ew].filter(Boolean).join(' ')}` : 'bagian tengah';
  const names = { H: 'lemari besar', B: 'ranjang', C: 'rak', T: W.map.id === 'kantor' ? 'meja kerja' : 'meja', L: 'lampu gantung', c: 'kursi', D: 'pintu' };
  for (const ch of ['H', 'B', 'C', 'T', 'c', 'D', 'L']) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && tileAt(cx + dx, cz + dz) === ch) return `${area}, di dekat ${names[ch]}`;
  }
  return area;
}

function placeItems(cells) {
  W.items.forEach(it => W.group.remove(it.mesh));
  W.items = cells.map(([cx, cz]) => {
    const m = makeItemModel(W.map.item.kind);
    m.position.set(center(cx), 0.8, center(cz));
    W.group.add(m);
    return { cx, cz, mesh: m, taken: false, pendingUntil: 0 };
  });
}

// Catatan: #1 dekat titik mulai (apa yang harus dicari), sisanya petunjuk lokasi tiap item.
function placeNotes(seed) {
  W.notes.forEach(n => W.group.remove(n.mesh));
  const r = rng(seed ^ 0x9e3779b9);
  const s = findCell('S');
  const used = new Set(W.items.map(it => it.cx + ',' + it.cz));
  used.add(s.join(','));
  const tables = []; const floors = [];
  for (let z = 0; z < W.h; z++) for (let x = 0; x < W.w; x++) {
    const ch = W.grid[z][x];
    if (ch === 'T') tables.push([x, z]);
    else if (ch === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => tileAt(x + dx, z + dz) === '#')) floors.push([x, z]);
  }
  const reach = reachable(W.grid, false);
  const okFloor = floors.filter(([x, z]) => reach.has(z * W.w + x));
  const pool = [...tables, ...okFloor];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const take = (cands) => { const c = cands.filter(p => !used.has(p.join(','))); if (!c.length) return null; const p = c[Math.floor(r() * c.length)]; used.add(p.join(',')); return p; };
  const item = W.map.item.name, n = W.items.length;
  const lore = W.map.notes || [];
  const list = [];
  const first = take(pool.filter(p => dist(p, s) < 5).sort((a, b) => dist(a, s) - dist(b, s)).slice(0, 3)) || take(pool);
  if (first) list.push({ at: first, title: 'Catatan yang tertinggal', text: `${lore[0] ?? ''}`, hint: `Untuk keluar kamu butuh ${n} ${item}. ${W.map.exitText} Catatan lain akan menunjukkan di mana barang-barang itu disembunyikan.`, item: -1 });
  W.items.forEach((it, i) => {
    const at = take(pool.filter(p => dist(p, [it.cx, it.cz]) > 5)) || take(pool);
    if (at) list.push({ at, title: `Catatan ${list.length + 1}`, text: lore[(i + 1) % Math.max(1, lore.length)] ?? '', hint: `${item} #${i + 1} ada di ${describe(it.cx, it.cz)}.`, item: i });
  });
  W.notes = list.map((nt) => {
    const onTable = W.grid[nt.at[1]][nt.at[0]] === 'T';
    const m = makeNoteModel();
    m.position.set(center(nt.at[0]) + (onTable ? -0.25 : (r() - 0.5) * 0.6), onTable ? 0.805 : 0.015, center(nt.at[1]) + (onTable ? 0 : (r() - 0.5) * 0.6));
    m.rotation.y = r() * Math.PI * 2;
    W.group.add(m);
    return { ...nt, cx: nt.at[0], cz: nt.at[1], mesh: m, read: false, x: m.position.x, z: m.position.z };
  });
}

// ======================= STATE PERMAINAN =======================
const G = {
  screen: 'menu', role: 'none', myId: 0, mode: 'solo', mapIdx: 0, seed: 1, diff: 'sedang', gtypeChoice: 'acak', gtype: 'kunti',
  players: new Map(), ghostId: -1, exitOpen: false, itemsMask: 0, paused: false,
  time: 0, vtime: 0, ended: false, lobby: [], ghostChoice: -1, hostIps: [],
  sendAcc: 0, beaconAcc: 0, scareTimer: 30, scareActive: 0, scareType: 'kunti',
  spectateIdx: 0, menuOpen: false, intro: null, reading: -1, journal: false, fullscreen: false,
  searched: new Set(), spawn: [0, 0],
};
const ghost = { x: 0, z: 0, ry: 0, vis: true, state: 'idle', path: [], replan: 0, target: null, lastSeen: null, searchT: 0, cool: 8, awayT: 0, seenHide: new Set(), tx: 0, tz: 0, anim: 0, blinkCd: 6, lostT: 0, stepT: 0, lastX: 0, lastZ: 0, giggleT: 8 };
let ghostMesh = null, apparition = null;
const D = () => DIFF[G.diff] || DIFF.sedang;
const GT = () => GHOSTS[G.gtype] || GHOSTS.kunti;

function me() { return G.players.get(G.myId); }
const isAuth = () => G.role === 'solo' || G.role === 'host';
const ghostPlayer = () => (G.mode === 'versus' ? G.players.get(G.ghostId) : null);
const iAmGhost = () => G.mode === 'versus' && G.myId === G.ghostId;
const overlayOpen = () => G.reading >= 0 || G.journal || !!G.intro || G.menuOpen;

function setGhostModel(type) {
  if (ghostMesh) scene.remove(ghostMesh);
  if (apparition) scene.remove(apparition);
  ghostMesh = makeGhostModel(type); scene.add(ghostMesh);
  apparition = makeGhostModel(type); apparition.visible = false; scene.add(apparition);
}

function startGame(cfg) {
  G.mode = cfg.mode; G.mapIdx = cfg.map; G.seed = cfg.seed; G.ghostId = cfg.ghostId ?? -1;
  G.diff = DIFF[cfg.diff] ? cfg.diff : 'sedang'; G.gtype = GHOSTS[cfg.gtype] ? cfg.gtype : 'kunti';
  G.exitOpen = false; G.itemsMask = 0; G.time = 0; G.ended = false; G.paused = false; G.menuOpen = false;
  G.vtime = cfg.vtime || 0; G.scareTimer = 25 + Math.random() * 20; G.scareActive = 0; G.spectateIdx = 0;
  G.reading = -1; G.journal = false; G.searched = new Set();
  buildWorld(cfg.map, G.diff);
  placeItems(cfg.items);
  placeNotes(cfg.seed);
  W.sign.material.map = W.signClosed;
  W.doorMesh.visible = true;
  setGhostModel(G.gtype);

  for (const p of G.players.values()) if (p.mesh) scene.remove(p.mesh);
  G.players.clear();
  cfg.players.forEach((p) => {
    const isG = G.mode === 'versus' && p.id === G.ghostId;
    const pl = { id: p.id, name: p.name, x: p.x, z: p.z, tx: p.x, tz: p.z, sx: p.x, sz: p.z, ry: Math.PI, pitch: 0, fl: !isG, sp: false, hid: false, hidCell: null, saved: null,
      state: isG ? 'ghost' : 'alive', color: COLORS[p.id % 4], mesh: null, stamina: 1, battery: 1, tired: false, stepT: 0, lives: D().lives };
    if (p.id !== G.myId && !isG) { pl.mesh = makeAvatar(pl.color, p.name); scene.add(pl.mesh); }
    G.players.set(p.id, pl);
  });

  // posisi awal hantu: acak (dikirim host), jauh dari pemain
  const gs = cfg.gs || findCell('G');
  Object.assign(ghost, { x: center(gs[0]), z: center(gs[1]), tx: center(gs[0]), tz: center(gs[1]), ry: 0, vis: G.mode !== 'versus', state: 'idle', path: [], replan: 0, target: null, lastSeen: null,
    searchT: 0, cool: INTRO + D().grace, awayT: 0, anim: 0, blinkCd: 6, lostT: 0, stepT: 0, lastX: center(gs[0]), lastZ: center(gs[1]), giggleT: 8 });
  ghost.seenHide = new Set();
  if (G.mode === 'versus') {
    ghost.cool = INTRO + 3;
    const gp = ghostPlayer();
    if (gp) { gp.x = gp.tx = gp.sx = ghost.x; gp.z = gp.tz = gp.sz = ghost.z; }
  }

  for (const id of faces.keys()) applyFaceToModels(id);
  showScreen('play');
  $('timer').hidden = G.mode !== 'versus';
  $('batBar').hidden = $('batLbl').hidden = iAmGhost();
  startIntro();
}

// Host/solo: susun konfigurasi permainan baru
function makeStartConfig(mode, mapIdx, roster, ghostChoice, diff, gtypeChoice) {
  const map = MAPS[mapIdx], seed = (Math.random() * 1e9) | 0, r = rng(seed);
  const grid = map.grid, w = grid[0].length;
  const ks = []; grid.forEach((row, z) => [...row].forEach((ch, x) => { if (ch === 'K') ks.push([x, z]); }));
  for (let i = ks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ks[i], ks[j]] = [ks[j], ks[i]]; }
  const d = DIFF[diff] || DIFF.sedang;
  const nItems = Math.min(ks.length, d.items + (mode === 'coop' && roster.length >= 3 && d.items < 5 ? 1 : 0));
  let ghostId = -1;
  if (mode === 'versus') ghostId = roster.some(p => p.id === ghostChoice) ? ghostChoice : roster[Math.floor(r() * roster.length)].id;
  const gtype = gtypeChoice === 'acak' || !GHOSTS[gtypeChoice] ? GHOST_KEYS[Math.floor(r() * GHOST_KEYS.length)] : gtypeChoice;
  const s = (() => { for (let z = 0; z < grid.length; z++) for (let x = 0; x < w; x++) if (grid[z][x] === 'S') return [x, z]; })();
  // posisi awal hantu acak: sel lantai yang jauh (> 12 m) dari titik mulai
  const reach = reachable(grid, false);
  const far = [...reach].map(k => [k % w, (k / w) | 0]).filter(([x, z]) => grid[z][x] !== 'X' && grid[z][x] !== 'S' && Math.hypot(x - s[0], z - s[1]) * CELL > 12);
  const gs = far.length ? far[Math.floor(r() * far.length)] : (() => { for (let z = 0; z < grid.length; z++) for (let x = 0; x < w; x++) if (grid[z][x] === 'G') return [x, z]; })();
  const spots = [[0, 0], [0.6, 0], [0, 0.6], [0.6, 0.6]];
  const players = roster.map((p, i) => ({ id: p.id, name: p.name, x: center(s[0]) - 0.3 + spots[i % 4][0], z: center(s[1]) - 0.3 + spots[i % 4][1] }));
  return { t: 'start', mode, map: mapIdx, seed, items: ks.slice(0, nItems), ghostId, players, vtime: mode === 'versus' ? 420 : 0, diff, gtype, gs };
}

// ======================= OPENING TIAP PETA =======================
function startIntro() {
  const intro = W.map.intro || { place: W.map.name, time: '', lines: [] };
  const ex = W.exit, s = findCell('S');
  const startCell = [ex.cx + W.exitInward[0], ex.cz + W.exitInward[1]];
  const cells = bfsPath(startCell[0], startCell[1], s[0], s[1]) || [];
  const pts = [startCell, ...cells].map(([x, z]) => [center(x), center(z)]);
  if (pts.length < 2) pts.push([center(s[0]), center(s[1]) + 0.1]);
  // panjang tiap ruas jalur kamera
  const seg = []; let len = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); len += l; }
  const reveal = G.mode === 'versus'
    ? 'Malam ini, salah satu dari kalian adalah <span class="ghostline">HANTU</span>.'
    : `Konon, tempat ini dihuni <span class="ghostline">${GT().name.toUpperCase()}</span>.`;
  G.intro = { t: 0, pts, seg, len, lines: [...intro.lines, reveal], appShown: false };
  $('introTitle').textContent = W.map.name;
  $('introPlace').textContent = [intro.place, intro.time].filter(Boolean).join(' · ');
  $('introLines').innerHTML = '';
  $('introFade').style.opacity = 0;
  $('intro').hidden = false;
  $('hud').hidden = true;
  sfx.intro();
}
function pointAt(I, s) {
  s = clamp(s, 0, I.len);
  for (let i = 0; i < I.seg.length; i++) {
    if (s <= I.seg[i] || i === I.seg.length - 1) { const t = I.seg[i] ? s / I.seg[i] : 0; return [lerp(I.pts[i][0], I.pts[i + 1][0], clamp(t, 0, 1)), lerp(I.pts[i][1], I.pts[i + 1][1], clamp(t, 0, 1))]; }
    s -= I.seg[i];
  }
  return I.pts[I.pts.length - 1];
}
function updateIntro(dt) {
  const I = G.intro;
  I.t += dt;
  const u = clamp(I.t / (INTRO - 1.5), 0, 1), e = u * u * (3 - 2 * u);
  const s = e * I.len;
  const [x, z] = pointAt(I, s), [lx, lz] = pointAt(I, s + 2.5);
  camera.position.set(x, EYE + Math.sin(I.t * 1.3) * 0.03, z);
  if (Math.hypot(lx - x, lz - z) > 0.05) camera.lookAt(lx, EYE - 0.1, lz);
  flash.intensity = 22;
  $('introTitle').style.opacity = I.t > 0.4 && I.t < 7 ? 1 : 0;
  $('introPlace').style.opacity = I.t > 1.2 && I.t < 7 ? 1 : 0;
  // teks cerita diketik satu per satu
  let html = '';
  I.lines.forEach((line, k) => {
    const start = 2.2 + k * 3.1;
    if (I.t < start) return;
    const plain = line.replace(/<[^>]+>/g, '');
    const n = Math.floor((I.t - start) * 32);
    html += `<div>${n >= plain.length ? line : escapeHtml(plain.slice(0, n))}</div>`;
  });
  $('introLines').innerHTML = html;
  // sosok hantu terlihat sekilas di depan kamera
  if (!I.appShown && I.t > INTRO * 0.6 && G.mode !== 'versus') {
    I.appShown = true;
    const [ax, az] = pointAt(I, s + 7);
    if (lineOfSight(x, z, ax, az)) {
      apparition.position.set(ax, 0, az);
      apparition.rotation.y = Math.atan2(x - ax, z - az);
      apparition.visible = true;
      sfx.stinger();
      setTimeout(() => { apparition.visible = false; }, 800);
    }
  }
  $('introFade').style.opacity = I.t > INTRO - 1.3 ? 1 : 0;
  if (I.t >= INTRO) endIntro();
}
function endIntro() {
  if (!G.intro) return;
  G.intro = null;
  $('intro').hidden = true;
  $('introFade').style.opacity = 0;
  if (apparition) apparition.visible = false;
  $('hud').hidden = false;
  // solo: waktu aman hantu dihitung sejak opening selesai (multiplayer: waktu tetap untuk semua)
  if (G.role === 'solo' && G.mode !== 'versus') ghost.cool = Math.max(0, D().grace);
  const m = me();
  if (m) { const s = findCell('S'); const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]]; const free = dirs.find(([dx, dz]) => !solidAt(s[0] + dx, s[1] + dz)) || [0, 1]; m.ry = Math.atan2(-free[0], -free[1]); }
  toast(iAmGhost() ? 'Kamu HANTU. Tangkap semua sebelum mereka kabur!' : `${W.map.exitText} Baca catatan untuk petunjuk.`, 6);
  if (G.mode !== 'versus') setTimeout(() => { if (G.screen === 'play' && !G.ended) { toast('Ada sesuatu yang terbangun…', 3); sfx.randomScare('scrape'); } }, Math.max(2000, (G.role === 'solo' ? D().grace : Math.max(0, INTRO + D().grace - G.time)) * 1000 - 1500));
  requestLock();
}
// di multiplayer gerakan baru dilepas setelah waktu opening habis untuk semua orang
const controlsLocked = () => !!G.intro || (G.role !== 'solo' && G.time < INTRO - 0.5);

// ======================= INPUT =======================
const keys = new Set();
let locked = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (G.screen !== 'play') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
  if (G.intro) { if (['Space', 'Enter', 'Escape'].includes(e.code) && !e.repeat) endIntro(); return; }
  if (e.repeat) return;
  if (G.reading >= 0) { if (['KeyE', 'Escape', 'Space', 'Enter'].includes(e.code)) closePaper(); return; }
  if (e.code === 'KeyJ' || e.code === 'Tab') { toggleJournal(); return; }
  if (G.journal) { if (e.code === 'Escape') toggleJournal(); return; }
  if (e.code === 'KeyF') toggleFlashlight();
  if (e.code === 'KeyE') interact();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
// Bug Chromium/WebView2 di Windows: saat pointer lock, kadang muncul satu event mousemove
// dengan movementX/Y sangat besar (terutama tepat setelah lock) -> pandangan "berbelok
// sendiri". Diatasi dengan: (1) lock mode gerakan mentah (unadjustedMovement, lihat
// requestLock), (2) buang beberapa event pertama setelah lock, (3) buang lonjakan yang
// jauh di atas gerakan wajar sebelumnya.
const look = { skip: 0, avg: 8 };
document.addEventListener('mousemove', (e) => {
  if (!locked || G.screen !== 'play' || overlayOpen()) return;
  if (look.skip > 0) { look.skip--; return; }
  const mx = e.movementX || 0, my = e.movementY || 0;
  const mag = Math.hypot(mx, my);
  // lonjakan: > 250 px dalam satu event, atau > 12x rata-rata gerakan terakhir (minimal 120 px)
  if (mag > 250 || (mag > 120 && mag > look.avg * 12)) return;
  look.avg = look.avg * 0.9 + mag * 0.1;
  const m = me(); if (!m || m.hid) return;
  const s = settings.sens * 0.00018;
  m.ry -= mx * s;
  m.pitch = clamp(m.pitch - my * s, -1.35, 1.35);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) { look.skip = 3; look.avg = 8; }
  if (locked || G.screen !== 'play' || G.ended || G.intro) return;
  // Esc saat membaca catatan / buku catatan: tutup itu dulu, bukan menu jeda
  if (G.reading >= 0) { closePaper(); return; }
  if (G.journal) { toggleJournal(); return; }
  openPause();
});
renderer.domElement.addEventListener('click', () => { if (G.screen === 'play' && !overlayOpen()) requestLock(); });
$('clickPlay').addEventListener('click', () => { sfx.unlock(); requestLock(); });
$('intro').addEventListener('click', () => endIntro());
$('paper').addEventListener('click', () => closePaper());
document.addEventListener('mousedown', () => { if (G.intro) { endIntro(); return; } if (G.screen === 'play' && locked) spectateNext(); });
$('intro').style.pointerEvents = 'auto';
function requestLock() {
  if (G.screen !== 'play' || overlayOpen()) return;
  const el = renderer.domElement;
  const plain = () => { try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch { } };
  // gerakan mentah (tanpa akselerasi Windows) - lebih stabil & tanpa lonjakan; kalau tidak didukung, pakai biasa
  try {
    const r = el.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); });
  } catch { plain(); }
}
function toggleFullscreen() {
  if (hasBridge) bridge({ cmd: 'fullscreen', on: !G.fullscreen });
  else if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { });
  else document.exitFullscreen?.();
}
document.addEventListener('fullscreenchange', () => { if (!hasBridge) { G.fullscreen = !!document.fullscreenElement; updateFsButtons(); } });
function updateFsButtons() { document.querySelectorAll('.fsBtn').forEach(b => { b.textContent = G.fullscreen ? '⛶ Keluar Layar Penuh' : '⛶ Layar Penuh'; }); }

function toggleFlashlight() {
  const m = me();
  if (!m || m.state !== 'alive' || m.hid || iAmGhost()) return;
  if (!m.fl && m.battery < 0.03) { toast('Baterai senter habis…', 1.5); return; }
  m.fl = !m.fl;
  sfx.flashlight();
}

// Apa yang sedang dilihat & cukup dekat untuk ditekan E (item, catatan, lemari, barang)
const SEARCH_NAMES = { B: 'ranjang', T: 'laci meja', C: 'rak' };
function findTarget(m) {
  const fx = -Math.sin(m.ry), fz = -Math.cos(m.ry);
  let best = null, bestScore = 1e9;
  const consider = (type, x, z, maxD, extra, weight) => {
    const dx = x - m.x, dz = z - m.z;
    let d = Math.hypot(dx, dz);
    // perabot/lemari: jarak ke sisi terdekatnya (bendanya selebar 1 sel), bukan ke titik tengah
    if (extra.cell) {
      const [cx, cz] = extra.cell;
      const nx = clamp(m.x, cx * CELL + 0.25, (cx + 1) * CELL - 0.25), nz = clamp(m.z, cz * CELL + 0.25, (cz + 1) * CELL - 0.25);
      d = Math.hypot(nx - m.x, nz - m.z);
    }
    if (d > maxD) return;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < 0.45 && d > 0.9) return;
    const score = d - dot * 1.2 + weight;
    if (score < bestScore) { bestScore = score; best = { type, ...extra, d }; }
  };
  if (iAmGhost()) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = cellOf(m.x) + dx, cz = cellOf(m.z) + dz;
      if (tileAt(cx, cz) === 'H') consider('check', center(cx), center(cz), 1.4, { cell: [cx, cz] }, 0);
    }
    return best;
  }
  W.items.forEach((it, i) => { if (!it.taken && it.mesh.visible) consider('item', center(it.cx), center(it.cz), 1.8, { i }, 0); });
  W.notes.forEach((n, i) => consider('note', n.x, n.z, 1.8, { i }, 0.1));
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = cellOf(m.x) + dx, cz = cellOf(m.z) + dz, ch = tileAt(cx, cz);
    if (ch === 'H') consider('locker', center(cx), center(cz), 1.2, { cell: [cx, cz] }, 0.3);
    else if (SEARCH_NAMES[ch] && !G.searched.has(cx + ',' + cz)) consider('search', center(cx), center(cz), 1.2, { cell: [cx, cz], ch }, 0.45);
  }
  return best;
}

function interact() {
  const m = me();
  if (!m || overlayOpen() || controlsLocked()) return;
  if (m.hid) { // keluar dari lemari
    m.hid = false; m.x = m.saved.x; m.z = m.saved.z; m.hidCell = null;
    sfx.locker();
    return;
  }
  const t = findTarget(m);
  if (!t) return;
  if (t.type === 'check') {
    sfx.locker();
    if (isAuth()) checkLocker(m.id, t.cell); else sendHost({ t: 'check', cx: t.cell[0], cz: t.cell[1] });
    return;
  }
  if (m.state !== 'alive') return;
  switch (t.type) {
    case 'item':
      if (isAuth()) pickItem(m.id, t.i);
      else { sendHost({ t: 'pick', i: t.i }); W.items[t.i].mesh.visible = false; W.items[t.i].pendingUntil = G.time + 1.5; }
      break;
    case 'note': openPaper(t.i); break;
    case 'locker': {
      const l = t.cell;
      m.saved = { x: m.x, z: m.z };
      m.hid = true; m.hidCell = l; m.fl = false;
      const fr = faceFromWall(l[0], l[1]);
      m.x = center(l[0]) - Math.sin(fr) * 0.42; m.z = center(l[1]) - Math.cos(fr) * 0.42;
      m.ry = fr + Math.PI; m.pitch = 0;
      sfx.locker();
      if (isAuth()) noteHide(m);
      break;
    }
    case 'search': searchFurniture(m, t.cell, t.ch); break;
  }
}

// Menggeledah perabot: hasilnya ditentukan seed + posisi (sama untuk semua pemain)
const FLAVOR = {
  B: ['Di bawah ranjang hanya ada debu dan sehelai rambut panjang.', 'Kasurnya masih hangat…', 'Ada boneka tanpa mata di bawah bantal.', 'Seprainya penuh noda cokelat yang sudah mengering.'],
  T: ['Laci berisi foto-foto lama. Semua wajahnya dicoret.', 'Kertas-kertas berserakan, penuh tulisan "JANGAN MENOLEH".', 'Lacinya kosong. Hanya bau anyir.', 'Ada jam saku yang berhenti di pukul 00:00.'],
  C: ['Rak penuh botol berdebu.', 'Di balik barang-barang ada bekas cakaran kuku.', 'Hanya kain-kain lusuh.', 'Sebuah kotak musik… berbunyi sendiri sebentar.'],
};
function searchFurniture(m, [cx, cz], ch) {
  const key = cx + ',' + cz;
  if (G.searched.has(key)) return;
  G.searched.add(key);
  sfx.search();
  const r = rng(G.seed + cx * 7919 + cz * 104729);
  const roll = r();
  const what = SEARCH_NAMES[ch];
  if (roll < D().loot) {
    m.battery = Math.min(1, m.battery + 0.5);
    setTimeout(() => sfx.battery(), 350);
    toast(`Kamu menggeledah ${what}… dapat BATERAI! Senter terisi.`, 3);
  } else if (roll < D().loot + 0.12) {
    setTimeout(() => { sfx.randomScare('bang'); W.lamps.forEach(l => { if (Math.hypot(l.x - m.x, l.z - m.z) < 12) l.flickerT = 1.5; }); }, 300);
    toast(`Sesuatu jatuh dari ${what}!`, 2);
  } else {
    const list = FLAVOR[ch];
    toast(list[Math.floor(r() * list.length)], 3.5);
  }
}

// ======================= CATATAN & BUKU CATATAN =======================
function openPaper(i) {
  const n = W.notes[i];
  if (!n) return;
  if (!n.read) { n.read = true; }
  G.reading = i;
  $('paperTitle').textContent = n.title;
  $('paperText').textContent = n.text;
  $('paperHint').textContent = n.hint;
  $('paper').hidden = false;
  sfx.paper();
}
function closePaper() {
  if (G.reading < 0) return;
  G.reading = -1;
  $('paper').hidden = true;
  sfx.paper();
  setTimeout(requestLock, 50);
}
function toggleJournal() {
  G.journal = !G.journal;
  $('journal').hidden = !G.journal;
  if (G.journal) { renderJournal(); if (document.pointerLockElement) document.exitPointerLock(); }
  else { $('pause').hidden || closePause(); setTimeout(requestLock, 50); }
}
function renderJournal() {
  const item = W.map.item.name;
  $('jSub').innerHTML = `${escapeHtml(W.map.name)} · ${escapeHtml(D().name)} · Hantu: ${G.mode === 'versus' ? 'salah satu pemain' : escapeHtml(GT().name)}`;
  $('jItems').innerHTML = W.items.map((it, i) => {
    const hintNote = W.notes.find(n => n.item === i && n.read);
    return `<div class="it ${it.taken ? 'done' : ''}">${it.taken ? '✔' : '○'} ${escapeHtml(item)} #${i + 1}<small>${it.taken ? 'Sudah ditemukan' : hintNote ? escapeHtml(hintNote.hint) : 'Lokasi belum diketahui - cari catatan.'}</small></div>`;
  }).join('') + `<div class="it ${G.exitOpen ? 'done' : ''}">${G.exitOpen ? '✔' : '○'} Pintu keluar<small>${G.exitOpen ? 'Terbuka - lari ke tanda KELUAR!' : 'Terkunci sampai semua ' + escapeHtml(item) + ' terkumpul.'}</small></div>`;
  const read = W.notes.map((n, i) => ({ n, i })).filter(x => x.n.read);
  $('jNotes').innerHTML = read.length ? '' : '<div class="sub">Belum ada. Catatan berupa kertas bercahaya di lantai atau meja - tekan E untuk membaca.</div>';
  for (const { n, i } of read) {
    const b = document.createElement('button');
    b.className = 'noteBtn';
    b.textContent = `📄 ${n.title}`;
    b.onclick = () => { toggleJournal(); openPaper(i); };
    $('jNotes').appendChild(b);
  }
}

// ======================= PEMAIN LOKAL =======================
function updateLocal(dt) {
  const m = me();
  if (!m) return;
  const active = !overlayOpen() && !G.paused && !controlsLocked();
  if (m.state === 'alive' || m.state === 'ghost') {
    if (!m.hid && active) {
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (keys.has('ArrowLeft')) m.ry += dt * 2.2;
      if (keys.has('ArrowRight')) m.ry -= dt * 2.2;
      const ghostP = m.state === 'ghost';
      const wantRun = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const moving = fwd !== 0 || side !== 0;
      if (m.stamina < 0.05) m.tired = true;
      if (m.tired && m.stamina > 0.4) m.tired = false;
      m.sp = wantRun && moving && !m.tired;
      m.stamina = clamp(m.stamina + (m.sp ? -dt / 5 : dt / 7), 0, 1);
      const gmul = Math.sqrt(GT().chase) * Math.sqrt(D().speed);
      const speed = ghostP ? (m.sp ? 5.0 : 3.5) * gmul : (m.sp ? 5.4 : 2.8);
      if (moving) {
        const len = Math.hypot(fwd, side);
        const sx = Math.sin(m.ry), cz = Math.cos(m.ry);
        const vx = (-sx * fwd + cz * side) / len * speed * dt;
        const vz = (-cz * fwd - sx * side) / len * speed * dt;
        if (!collides(m.x + vx, m.z, PR)) m.x += vx;
        if (!collides(m.x, m.z + vz, PR)) m.z += vz;
        m.stepT -= dt * (m.sp ? 1.6 : 1);
        if (m.stepT <= 0) { m.stepT = 0.5; if (!ghostP) sfx.step(m.sp, W.map.floor === 'wood' ? 'wood' : W.map.floor === 'carpet' ? 'carpet' : 'tile'); }
        m.bob = (m.bob || 0) + dt * (m.sp ? 13 : 8);
      } else m.sp = false;
    } else m.sp = false;
    if (m.state === 'alive') {
      if (m.fl) { m.battery = Math.max(0, m.battery - dt / D().battery); if (m.battery <= 0) { m.fl = false; toast('Senter mati - matikan sebentar untuk mengisi, atau cari baterai di laci', 3); } }
      else m.battery = Math.min(1, m.battery + dt / 60);
    }
    if (m.state === 'alive' && G.exitOpen && !m.hid) {
      const ex = W.exit;
      if (Math.hypot(center(ex.cx) - m.x, center(ex.cz) - m.z) < 1.3) {
        if (isAuth()) playerEscaped(m.id); else if (!m.escapeSent) { m.escapeSent = true; sendHost({ t: 'escape' }); }
      }
    }
  }
}

// ======================= HANTU (AI, hanya di host/solo) =======================
function aiGhost(dt) {
  if (ghost.cool > 0) {
    ghost.cool -= dt;
    ghost.vis = ghost.state !== 'gone' || ghost.cool < 5;
    if (ghost.cool > 0) return;
    ghost.state = 'wander'; ghost.vis = true;
  }
  const gt = GT(), d = D(), mapSp = W.map.ghost;
  const alive = [...G.players.values()].filter(p => p.state === 'alive');
  if (!alive.length) return;
  let best = null, bestD = 1e9, bestSees = false;
  for (const p of alive) {
    const dist = Math.hypot(p.x - ghost.x, p.z - ghost.z);
    if (p.hid) {
      if (ghost.seenHide.has(p.id) && dist < 22 && dist < bestD) { best = p; bestD = dist; }
      continue;
    }
    const range = (p.fl ? 15 : 8) * d.sight;
    const sees = dist < range && lineOfSight(ghost.x, ghost.z, p.x, p.z);
    const hears = p.sp && dist < 9 * d.hear;
    if ((sees || hears || dist < 2.2) && dist < bestD) { best = p; bestD = dist; bestSees = sees; }
  }
  if (best) {
    if (ghost.state !== 'chase') onGhostChaseStart();
    ghost.state = 'chase'; ghost.target = best.id; ghost.lastSeen = [best.x, best.z]; ghost.searchT = gt.give; ghost.lostT = 0;
  } else if (ghost.state === 'chase') { ghost.state = 'search'; }

  // Pocong: berpindah tempat beberapa sel saat tidak ada yang melihat
  if (G.gtype === 'pocong' && (ghost.state === 'chase' || ghost.state === 'search')) {
    ghost.blinkCd -= dt;
    if (ghost.blinkCd <= 0 && ghost.path.length > 3 && !alive.some(p => lineOfSight(p.x, p.z, ghost.x, ghost.z) && Math.hypot(p.x - ghost.x, p.z - ghost.z) < 18)) {
      const k = Math.min(4, ghost.path.length - 1);
      const [bx, bz] = ghost.path[k];
      ghost.x = center(bx); ghost.z = center(bz); ghost.path.splice(0, k + 1);
      ghost.blinkCd = 6 / d.speed;
    }
  }

  ghost.replan -= dt;
  if (ghost.replan <= 0 || !ghost.path || !ghost.path.length) {
    ghost.replan = ghost.state === 'chase' ? 0.35 : 2.5;
    let goal = null;
    if (ghost.state === 'chase' && ghost.lastSeen) goal = [cellOf(ghost.lastSeen[0]), cellOf(ghost.lastSeen[1])];
    else if (ghost.state === 'search') {
      ghost.searchT -= 2.5;
      if (ghost.searchT <= 0 || !ghost.lastSeen) ghost.state = 'wander';
      else goal = [cellOf(ghost.lastSeen[0]) + Math.round(Math.random() * 4 - 2), cellOf(ghost.lastSeen[1]) + Math.round(Math.random() * 4 - 2)];
    }
    if (!goal || solidAt(goal[0], goal[1])) {
      const p = alive[Math.floor(Math.random() * alive.length)];
      const near = W.walk.filter(([x, z]) => Math.abs(x - cellOf(p.x)) + Math.abs(z - cellOf(p.z)) < 9);
      const pool = Math.random() < 0.65 && near.length ? near : W.walk;
      goal = pool[Math.floor(Math.random() * pool.length)];
    }
    ghost.path = bfsPath(cellOf(ghost.x), cellOf(ghost.z), goal[0], goal[1]) || [];
  }
  const base = ghost.state === 'chase' ? mapSp.chase * gt.chase : mapSp.wander * gt.wander;
  const speed = Math.min(5.6, base * d.speed);
  if (ghost.state === 'chase' && ghost.target != null) {
    const p = G.players.get(ghost.target);
    if (p && !p.hid && Math.hypot(p.x - ghost.x, p.z - ghost.z) < 3 && lineOfSight(ghost.x, ghost.z, p.x, p.z)) { moveGhostToward(p.x, p.z, speed * dt); return; }
  }
  if (ghost.path.length) {
    const [nx, nz] = ghost.path[0];
    if (moveGhostToward(center(nx), center(nz), speed * dt)) ghost.path.shift();
  }
  const minD = Math.min(...alive.map(p => Math.hypot(p.x - ghost.x, p.z - ghost.z)));
  ghost.awayT = minD > 18 ? ghost.awayT + dt : 0;
  if (ghost.awayT > 20 / d.speed) { ghost.awayT = 0; teleportGhost(alive); }
}
function moveGhostToward(tx, tz, step) {
  const dx = tx - ghost.x, dz = tz - ghost.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const s = Math.min(step, d);
  ghost.x += dx / d * s; ghost.z += dz / d * s;
  ghost.ry = Math.atan2(dx, dz);
  return d <= step + 0.05;
}
function teleportGhost(alive) {
  const p = alive[Math.floor(Math.random() * alive.length)];
  const cand = W.walk.filter(([x, z]) => {
    const d = Math.hypot(center(x) - p.x, center(z) - p.z);
    return d > 9 && d < 16 && !alive.some(q => lineOfSight(q.x, q.z, center(x), center(z)));
  });
  if (!cand.length) return;
  const c = cand[Math.floor(Math.random() * cand.length)];
  ghost.x = center(c[0]); ghost.z = center(c[1]); ghost.path = []; ghost.state = 'wander';
}
function noteHide(p) {
  if (G.mode === 'versus') return;
  const d = Math.hypot(p.x - ghost.x, p.z - ghost.z);
  if (ghost.state === 'chase' && d < 7 * D().sight && lineOfSight(ghost.x, ghost.z, p.saved?.x ?? p.x, p.saved?.z ?? p.z)) ghost.seenHide.add(p.id);
  else ghost.seenHide.delete(p.id);
  if (ghost.target === p.id && !ghost.seenHide.has(p.id)) ghost.state = 'search';
}

// ======================= ATURAN (host/solo) =======================
function pickItem(id, i) {
  const it = W.items[i], p = G.players.get(id);
  if (!it || it.taken || !p || p.state !== 'alive') return;
  const px = p.id === G.myId ? p.x : p.tx, pz = p.id === G.myId ? p.z : p.tz;
  if (Math.hypot(center(it.cx) - px, center(it.cz) - pz) > 2.4) return;
  applyPick(i, id);
  sendAll({ t: 'pick', i, by: id });
  if (W.items.every(x => x.taken) && !G.exitOpen) { applyExitOpen(); sendAll({ t: 'exit' }); }
}
function applyPick(i, by) {
  const it = W.items[i];
  if (!it || it.taken) return;
  it.taken = true; it.mesh.visible = false;
  G.itemsMask |= 1 << i;
  sfx.pickup();
  const p = G.players.get(by);
  const n = W.items.filter(x => x.taken).length;
  toast(`${by === G.myId ? 'Kamu' : p?.name ?? '?'} menemukan ${W.map.item.name} (${n}/${W.items.length})`, 2.5);
  if (G.mode !== 'versus' && isAuth() && Math.random() < 0.5) { ghost.state = 'search'; ghost.lastSeen = [center(it.cx), center(it.cz)]; ghost.searchT = 8; ghost.replan = 0; }
  if (G.journal) renderJournal();
}
function applyExitOpen() {
  if (G.exitOpen) return;
  G.exitOpen = true;
  W.doorMesh.visible = false;
  W.sign.material.map = W.signOpen; W.sign.material.needsUpdate = true;
  sfx.unlock3();
  toast('Pintu keluar TERBUKA! Lari ke sana!', 4);
}
function playerEscaped(id) {
  const p = G.players.get(id);
  if (!p || p.state !== 'alive' || !G.exitOpen) return;
  p.state = 'escaped'; p.hid = false;
  sendAll({ t: 'esc', id });
  onEscaped(id);
}
function onEscaped(id) {
  const p = G.players.get(id);
  if (p) { p.state = 'escaped'; if (p.mesh) p.mesh.visible = false; }
  if (id === G.myId) { toast('Kamu berhasil kabur!', 3); sfx.win(); }
  else toast(`${p?.name ?? '?'} berhasil kabur!`, 2.5);
}
function ghostRetreat(id) {
  if (G.mode === 'versus') return;
  ghost.state = 'gone'; ghost.cool = 7; ghost.vis = false; ghost.seenHide.delete(id); ghost.path = [];
  setTimeout(() => { if (isAuth()) { const alive = [...G.players.values()].filter(q => q.state === 'alive'); if (alive.length) teleportGhost(alive); } }, 100);
}
function catchPlayer(id, by) {
  const p = G.players.get(id);
  if (!p || p.state !== 'alive') return;
  // Mudah: nyawa cadangan - kena jumpscare tapi kembali ke titik mulai
  if (p.lives > 1) {
    p.lives--;
    p.hid = false;
    sendAll({ t: 'hurt', id });
    onHurt(id);
    ghostRetreat(id);
    if (G.mode === 'versus') ghost.cool = 3;
    return;
  }
  p.state = 'caught'; p.hid = false;
  sendAll({ t: 'caught', id, by });
  onCaught(id);
  ghostRetreat(id);
}
function onHurt(id) {
  const p = G.players.get(id);
  if (id === G.myId && p) {
    jumpscare();
    p.lives = Math.max(1, p.lives - (isAuth() ? 0 : 1));
    p.hid = false; p.hidCell = null; p.x = p.sx; p.z = p.sz; p.tx = p.sx; p.tz = p.sz;
    setTimeout(() => toast('Kamu lolos kali ini… tersisa 1 nyawa.', 3.5), 1600);
  } else toast(`${p?.name ?? '?'} hampir tertangkap!`, 2.5);
}
function onCaught(id) {
  const p = G.players.get(id);
  if (p) { p.state = 'caught'; if (p.mesh) p.mesh.visible = false; }
  if (id === G.myId) jumpscare();
  else { toast(`${p?.name ?? '?'} tertangkap!`, 2.5); sfx.randomScare('bang'); }
}
function checkLocker(byId, [cx, cz]) {
  for (const p of G.players.values()) {
    if (p.state === 'alive' && p.hid && p.hidCell && p.hidCell[0] === cx && p.hidCell[1] === cz) { catchPlayer(p.id, byId); return; }
  }
  if (byId === G.myId) toast('Kosong…', 1.2); else sendTo(byId, { t: 'msg', text: 'Kosong…' });
}
function authorityTick(dt) {
  if (G.ended) return;
  G.time += dt;
  if (G.mode === 'versus') {
    const gp = ghostPlayer();
    if (gp) { ghost.x = gp.x; ghost.z = gp.z; ghost.ry = gp.ry + Math.PI; ghost.vis = true; ghost.state = 'chase'; }
    if (ghost.cool > 0) ghost.cool -= dt;
    if (G.time > INTRO) G.vtime = Math.max(0, G.vtime - dt);
  } else aiGhost(dt);
  const reach = G.mode === 'versus' ? 1.1 : G.gtype === 'genderuwo' ? 1.05 : 0.85;
  if (ghost.vis && ghost.cool <= 0) for (const p of G.players.values()) {
    if (p.state !== 'alive') continue;
    if (p.hid) {
      if (G.mode !== 'versus' && ghost.seenHide.has(p.id) && Math.hypot(center(p.hidCell[0]) - ghost.x, center(p.hidCell[1]) - ghost.z) < 1.6) catchPlayer(p.id, -1);
      continue;
    }
    if (Math.hypot(p.x - ghost.x, p.z - ghost.z) < reach) catchPlayer(p.id, G.mode === 'versus' ? G.ghostId : -1);
  }
  const surv = [...G.players.values()].filter(p => p.state !== 'ghost');
  const alive = surv.filter(p => p.state === 'alive');
  const esc = surv.filter(p => p.state === 'escaped');
  let result = null;
  if (G.mode === 'versus') {
    if (!ghostPlayer()) result = 'ghostleft';
    else if (!alive.length) result = esc.length ? 'survivors' : 'ghost';
    else if (G.vtime <= 0) result = 'ghost';
  } else if (!alive.length) result = esc.length ? 'escaped' : 'caught';
  if (result) endGame(result);
}
function endGame(result) {
  if (G.ended) return;
  G.ended = true;
  const list = [...G.players.values()].map(p => ({ id: p.id, name: p.name, state: p.state }));
  const data = { t: 'end', result, list, time: Math.round(G.time) };
  sendAll(data);
  onEnd(data);
}
function onEnd(data) {
  G.ended = true;
  const delay = G.scareActive > 0 ? 1800 : 1200;
  setTimeout(() => showEnd(data), delay);
}

// ======================= JARINGAN (pesan game) =======================
function onData(from, d) {
  if (!d || typeof d !== 'object') return;
  if (G.role === 'host') {
    const p = G.players.get(from);
    switch (d.t) {
      case 'pose':
        if (!p || G.screen !== 'play') return;
        p.tx = d.x; p.tz = d.z; p.ry = d.ry; p.fl = !!d.fl; p.sp = !!d.sp;
        if (!p.hid && d.hid) { p.hid = true; p.hidCell = d.hc; p.saved = { x: d.sx ?? d.x, z: d.sz ?? d.z }; p.x = p.tx; p.z = p.tz; noteHide(p); }
        else if (p.hid && !d.hid) { p.hid = false; p.hidCell = null; }
        break;
      case 'pick': pickItem(from, d.i); break;
      case 'escape': if (p && G.exitOpen && Math.hypot(center(W.exit.cx) - p.tx, center(W.exit.cz) - p.tz) < 2.5) playerEscaped(from); break;
      case 'check': if (G.mode === 'versus' && from === G.ghostId) checkLocker(from, [d.cx, d.cz]); break;
      case 'face':
        if (typeof d.img !== 'string' || d.img.length > 60000 || (d.img && !d.img.startsWith('data:image/jpeg'))) return;
        setFace(from, d.img);
        sendAll({ t: 'face', id: from, img: d.img });
        break;
    }
    return;
  }
  switch (d.t) {
    case 'lobby': G.lobby = d.players; G.mode = d.mode; G.mapIdx = d.map; G.ghostChoice = d.ghost; G.diff = d.diff || 'sedang'; G.gtypeChoice = d.gtype || 'acak'; if (G.screen !== 'play' || G.ended) showScreen('lobby'); renderLobby(); break;
    case 'start': startGame(d); break;
    case 'snap': applySnap(d); break;
    case 'pick': applyPick(d.i, d.by); break;
    case 'exit': applyExitOpen(); break;
    case 'esc': onEscaped(d.id); break;
    case 'caught': onCaught(d.id); break;
    case 'hurt': onHurt(d.id); break;
    case 'end': onEnd(d); break;
    case 'msg': toast(d.text, 2); break;
    case 'face':
      if (d.id !== G.myId && typeof d.img === 'string' && d.img.length <= 60000 && (!d.img || d.img.startsWith('data:image/jpeg'))) setFace(d.id, d.img);
      break;
  }
}
function applySnap(d) {
  if (G.screen !== 'play') return;
  const codes = ['alive', 'caught', 'escaped', 'ghost'];
  for (const [id, x, z, ry, fl, st, hid] of d.pl) {
    const p = G.players.get(id);
    if (!p) continue;
    const state = codes[st] || 'alive';
    if (id === G.myId) { if (state !== p.state && state !== 'alive') p.state = state; continue; }
    p.tx = x; p.tz = z; p.ry = ry; p.fl = !!fl; p.hid = !!hid; p.state = state;
  }
  if (d.g) {
    ghost.tx = d.g[0]; ghost.tz = d.g[1]; ghost.ry = d.g[2]; ghost.vis = !!d.g[3];
    const st = ['wander', 'chase', 'search', 'gone'][d.g[4] ?? 0];
    if (st === 'chase' && ghost.state !== 'chase' && G.mode !== 'versus') onGhostChaseStart();
    ghost.state = st;
    if (Math.hypot(ghost.tx - ghost.x, ghost.tz - ghost.z) > 4) { ghost.x = ghost.tx; ghost.z = ghost.tz; } // pocong berpindah / teleport
  }
  if (d.ex && !G.exitOpen) applyExitOpen();
  W.items.forEach((it, i) => {
    if ((d.it >> i) & 1) { if (!it.taken) { it.taken = true; it.mesh.visible = false; } }
    else if (it.pendingUntil && G.time > it.pendingUntil) { it.pendingUntil = 0; it.mesh.visible = true; }
  });
  if (typeof d.vt === 'number') G.vtime = d.vt;
}
function sendSnapshot() {
  const codes = { alive: 0, caught: 1, escaped: 2, ghost: 3 };
  const r2 = (v) => Math.round(v * 100) / 100;
  sendAll({
    t: 'snap', it: G.itemsMask, ex: G.exitOpen ? 1 : 0, vt: Math.round(G.vtime),
    pl: [...G.players.values()].map(p => [p.id, r2(p.x), r2(p.z), r2(p.ry), p.fl ? 1 : 0, codes[p.state] ?? 0, p.hid ? 1 : 0]),
    g: [r2(ghost.x), r2(ghost.z), r2(ghost.ry), ghost.vis ? 1 : 0, STATE_CODE[ghost.state] ?? 0],
  });
}

function onBridge(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.ev) {
    case 'info':
      if (!settings.name) { settings.name = cleanName(m.name); $('nameIn').value = settings.name; }
      break;
    case 'hosted':
      G.role = 'host'; G.myId = 0; G.hostIps = m.ips || []; setMsg('');
      G.lobby = [{ id: 0, name: settings.name }];
      if (G.mode === 'solo') G.mode = 'coop';
      showScreen('lobby'); renderLobby(); broadcastLobby();
      break;
    case 'joined':
      G.role = 'client'; G.myId = m.id;
      $('joinMsg').textContent = '';
      bridge({ cmd: 'discover', on: false });
      showScreen('lobby'); renderLobby();
      break;
    case 'peer':
      if (G.role !== 'host') return;
      if (m.joined) {
        if (G.screen === 'play' && !G.ended) { bridge({ cmd: 'kick', id: m.id, msg: 'Permainan sedang berlangsung - tunggu sampai selesai.' }); return; }
        G.lobby.push({ id: m.id, name: cleanName(m.name) });
        toast(`${cleanName(m.name)} masuk`, 2);
      } else {
        const p = G.lobby.find(x => x.id === m.id);
        G.lobby = G.lobby.filter(x => x.id !== m.id);
        if (p) toast(`${p.name} keluar`, 2);
        setFace(m.id, '');
        const pl = G.players.get(m.id);
        if (pl && G.screen === 'play') { if (pl.mesh) scene.remove(pl.mesh); G.players.delete(m.id); }
      }
      renderLobby(); broadcastLobby();
      break;
    case 'data': onData(m.from, m.data); break;
    case 'hosts': renderHosts(m.list || [], m.error); break;
    case 'error': setMsg(m.msg); break;
    case 'closed': leaveToMenu(m.msg || 'Koneksi terputus.'); break;
    case 'fw': setMsg(m.msg); break;
    case 'fullscreen': G.fullscreen = !!m.on; updateFsButtons(); setTimeout(resize, 50); break;
    case 'visible':
      if (!m.v) { keys.clear(); if (document.pointerLockElement) document.exitPointerLock(); if (G.screen === 'play' && G.role === 'solo' && !G.ended && !G.intro) openPause(); }
      break;
  }
}
function setMsg(text) { for (const id of ['menuMsg', 'joinMsg', 'lobbyMsg', 'endMsg']) $(id).textContent = text || ''; }
function broadcastLobby() {
  if (G.role !== 'host') return;
  sendAll({ t: 'lobby', players: G.lobby, mode: G.mode, map: G.mapIdx, ghost: G.ghostChoice, diff: G.diff, gtype: G.gtypeChoice });
}

// ======================= EFEK SERAM =======================
function onGhostChaseStart() {
  sfx.stinger();
  ghost.giggleT = Math.min(ghost.giggleT, 0.4); // suara khasnya langsung terdengar
}
// Suara hantu terarah (kiri/kanan), makin keras saat dekat, teredam kalau terhalang dinding.
// Langkah tiap jenis hantu berbeda, ditambah suara khas (tawa, erangan, geraman, bisikan).
const STEP_GAP = { kunti: [0.75, 0.42], pocong: [0.55, 0.4], genderuwo: [0.65, 0.36], anak: [0.32, 0.2], bayangan: [0.9, 0.55] };
function ghostAmbience(dt) {
  if (!ghost.vis || G.intro || !ghostMesh) return;
  if (G.mode === 'versus' && iAmGhost()) return;
  const lx = camera.position.x, lz = camera.position.z;
  const dx = ghost.x - lx, dz = ghost.z - lz, d = Math.hypot(dx, dz);
  const level = clamp(1 - d / 24, 0, 1) ** 1.3;
  if (level <= 0.01) { ghost.lastX = ghost.x; ghost.lastZ = ghost.z; return; }
  const ry = camera.rotation.y;
  const pan = d > 0.3 ? (dx * Math.cos(ry) - dz * Math.sin(ry)) / d : 0; // proyeksi ke arah kanan pendengar
  const muffled = !lineOfSight(lx, lz, ghost.x, ghost.z);
  const vol = level * (muffled ? 0.75 : 1);
  const chasing = ghost.state === 'chase';
  const moved = Math.hypot(ghost.x - ghost.lastX, ghost.z - ghost.lastZ);
  ghost.lastX = ghost.x; ghost.lastZ = ghost.z;
  ghost.stepT -= dt;
  if (moved > 0.0005 && ghost.stepT <= 0) {
    const gap = STEP_GAP[G.gtype] || STEP_GAP.kunti;
    ghost.stepT = chasing ? gap[1] : gap[0];
    sfx.ghostStep(G.gtype, vol, pan, muffled);
  }
  ghost.giggleT -= dt;
  if (ghost.giggleT <= 0) {
    ghost.giggleT = chasing ? 4 + Math.random() * 4 : 9 + Math.random() * 12;
    sfx.ghostVoice(G.gtype, Math.min(1, vol * 1.15), pan, muffled, chasing);
  }
}
function randomScares(dt) {
  const m = me();
  if (!m || m.state !== 'alive' || iAmGhost() || controlsLocked()) return;
  G.scareTimer -= dt;
  if (G.scareTimer > 0) return;
  G.scareTimer = 22 + Math.random() * 30;
  const kinds = ['whisper', 'knock', 'bang', 'giggle', 'scrape', 'flicker', 'flicker'];
  if (G.mode !== 'versus') kinds.push('apparition', 'apparition');
  const k = kinds[Math.floor(Math.random() * kinds.length)];
  if (k === 'flicker') { W.lamps.forEach(l => { l.flickerT = 2 + Math.random(); }); sfx.randomScare('scrape'); }
  else if (k === 'apparition') showApparition(m);
  else sfx.randomScare(k);
}
function showApparition(m) {
  const dirX = -Math.sin(m.ry), dirZ = -Math.cos(m.ry);
  for (let d = 12; d >= 6; d -= 1) {
    const x = m.x + dirX * d, z = m.z + dirZ * d;
    if (solidAt(cellOf(x), cellOf(z)) || !lineOfSight(m.x, m.z, x, z)) continue;
    apparition.position.set(x, 0, z);
    apparition.rotation.y = Math.atan2(m.x - x, m.z - z);
    apparition.visible = true;
    sfx.stinger();
    setTimeout(() => { apparition.visible = false; }, 650);
    return;
  }
  sfx.randomScare('whisper');
}

// ======================= JUMPSCARE (wajah berbeda per hantu) =======================
const scareCanvas = $('scare'), sctx = scareCanvas.getContext('2d');
function jumpscare() {
  G.scareActive = 1.5;
  G.scareType = G.mode === 'versus' ? G.gtype : G.gtype;
  closePaper(); if (G.journal) toggleJournal();
  scareCanvas.hidden = false;
  scareCanvas.width = 480; scareCanvas.height = 270;
  sfx.scream(G.scareType);
  const fl = $('flash');
  fl.style.transition = 'none'; fl.style.opacity = 0.9;
  requestAnimationFrame(() => { fl.style.transition = 'opacity .5s'; fl.style.opacity = 0; });
}
function eyeGlow(g, x, y, r, inner, outer) {
  const eg = g.createRadialGradient(x, y, 0, x, y, r); eg.addColorStop(0, '#fff'); eg.addColorStop(0.3, inner); eg.addColorStop(1, outer);
  g.fillStyle = eg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function drawFace(g, type, t) {
  const R = () => Math.random();
  switch (type) {
    case 'pocong': {
      g.fillStyle = '#d8d4c8'; g.beginPath(); g.ellipse(0, 10, 125, 150, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#9a968c'; g.lineWidth = 4; for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(-125, i * 30); g.quadraticCurveTo(0, i * 30 + 12, 125, i * 30); g.stroke(); }
      g.fillStyle = '#100a06'; g.beginPath(); g.ellipse(0, 5, 78, 100, 0, 0, Math.PI * 2); g.fill();
      const fg = g.createRadialGradient(0, 0, 10, 0, 0, 90); fg.addColorStop(0, '#8a8274'); fg.addColorStop(1, '#2a241c');
      g.fillStyle = fg; g.beginPath(); g.ellipse(0, 8, 64, 86, 0, 0, Math.PI * 2); g.fill();
      for (const x of [-26, 26]) { g.fillStyle = '#f4f2ea'; g.beginPath(); g.ellipse(x, -12, 15 + R() * 2, 11, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#050302'; g.beginPath(); g.ellipse(0, 46, 20, 18 + Math.sin(t * 30) * 4, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'genderuwo': {
      g.fillStyle = '#2a1a10'; g.beginPath(); g.ellipse(0, 0, 135, 140, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#140c06'; g.lineWidth = 3; for (let i = 0; i < 70; i++) { const a = R() * Math.PI * 2, r = 60 + R() * 80; g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a) * (r + 25), Math.sin(a) * (r + 25)); g.stroke(); }
      g.fillStyle = '#3a2416'; g.beginPath(); g.ellipse(0, 10, 90, 100, 0, 0, Math.PI * 2); g.fill();
      for (const x of [-40, 40]) { g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, -25, 26, 20, x < 0 ? -0.3 : 0.3, 0, Math.PI * 2); g.fill(); eyeGlow(g, x, -24, 16, '#ff1010', 'rgba(255,0,0,0)'); }
      g.fillStyle = '#0a0000'; g.beginPath(); g.ellipse(0, 55, 62, 34 + Math.sin(t * 25) * 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e0c8'; for (const x of [-38, -14, 14, 38]) { g.beginPath(); g.moveTo(x - 7, 26); g.lineTo(x + 7, 26); g.lineTo(x, x === -38 || x === 38 ? 70 : 48); g.fill(); }
      break;
    }
    case 'anak': {
      g.fillStyle = '#050505'; g.beginPath(); g.ellipse(0, -20, 120, 120, 0, Math.PI, Math.PI * 2); g.fill();
      const fg = g.createRadialGradient(0, 0, 10, 0, 10, 120); fg.addColorStop(0, '#e2ded6'); fg.addColorStop(1, '#6a665e');
      g.fillStyle = fg; g.beginPath(); g.ellipse(0, 15, 100, 110, 0, 0, Math.PI * 2); g.fill();
      // poni lurus menutupi dahi, rambut tipis menjuntai
      g.fillStyle = '#050505'; g.fillRect(-105, -78, 210, 40);
      g.strokeStyle = '#050505'; g.lineWidth = 3;
      for (let i = 0; i < 6; i++) { const x = -60 + i * 24; g.beginPath(); g.moveTo(x, -40); g.lineTo(x + (R() - 0.5) * 8, -5 + R() * 20); g.stroke(); }
      for (const x of [-36, 36]) {
        // lingkar mata lebam + rongga mata kosong yang meneteskan cairan hitam
        const bg = g.createRadialGradient(x, -2, 10, x, -2, 44); bg.addColorStop(0, 'rgba(60,20,60,.9)'); bg.addColorStop(1, 'rgba(60,20,60,0)');
        g.fillStyle = bg; g.beginPath(); g.arc(x, -2, 44, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#000'; g.beginPath(); g.ellipse(x + (R() - 0.5) * 2, -4, 24, 30, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#000';
        for (const dx of [-10, 2, 12]) { const len = 30 + R() * 40 + t * 40; g.fillRect(x + dx, 18, 4, len); g.beginPath(); g.arc(x + dx + 2, 18 + len, 3.5, 0, Math.PI * 2); g.fill(); }
      }
      // seringai yang terlalu lebar sampai ke pipi, penuh gigi kecil
      const grin = 8 + Math.sin(t * 22) * 4;
      g.fillStyle = '#120000'; g.beginPath(); g.moveTo(-78, 40); g.quadraticCurveTo(0, 105 + grin, 78, 40); g.quadraticCurveTo(0, 62, -78, 40); g.fill();
      g.fillStyle = '#d8d0b8';
      for (let i = -6; i <= 6; i++) { const x = i * 11, y = 47 + Math.abs(i) * -1.2 + 6; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.lineTo(x, y + 9); g.fill(); }
      g.strokeStyle = 'rgba(40,0,0,.7)'; g.lineWidth = 2;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 78, 40); g.lineTo(s * 92, 30); g.lineTo(s * 98, 42); g.stroke(); } // sobekan di sudut mulut
      break;
    }
    case 'bayangan': {
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, 0, 110, 140, 0, 0, Math.PI * 2); g.fill();
      for (const x of [-34, 34]) eyeGlow(g, x, -20, 22, '#e8e8ff', 'rgba(200,200,255,0)');
      g.fillStyle = '#f0f0ff'; g.beginPath(); g.moveTo(-70, 40); g.quadraticCurveTo(0, 110 + Math.sin(t * 25) * 6, 70, 40); g.quadraticCurveTo(0, 70, -70, 40); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 3; for (let x = -60; x <= 60; x += 10) { g.beginPath(); g.moveTo(x, 44); g.lineTo(x, 90); g.stroke(); }
      break;
    }
    default: { // kuntilanak
      const fg = g.createRadialGradient(0, -10, 10, 0, 0, 130);
      fg.addColorStop(0, '#d8d2c4'); fg.addColorStop(0.7, '#8a8478'); fg.addColorStop(1, '#1a1814');
      g.fillStyle = fg; g.beginPath(); g.ellipse(0, 0, 95 + R() * 3, 125, 0, 0, Math.PI * 2); g.fill();
      for (const x of [-38, 38]) {
        g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, -25, 24 + R() * 2, 30, x < 0 ? 0.2 : -0.2, 0, Math.PI * 2); g.fill();
        eyeGlow(g, x + (R() - 0.5) * 3, -22, 9, '#ff2020', 'rgba(255,0,0,0)');
        g.strokeStyle = 'rgba(80,0,0,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 4, 4); g.lineTo(x - 7, 40 + R() * 20); g.stroke();
      }
      const open = 40 + Math.sin(t * 30) * 6;
      g.fillStyle = '#050000'; g.beginPath(); g.ellipse(0, 62, 32, open, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ddd6c0';
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 9 - 4, 62 - open + 4); g.lineTo(i * 9 + 4, 62 - open + 4); g.lineTo(i * 9, 62 - open + 16); g.fill(); }
      g.strokeStyle = '#030303'; g.lineWidth = 6;
      for (let i = 0; i < 14; i++) {
        const side = i < 7 ? -1 : 1, k = i % 7, x = side * (70 + k * 9);
        g.beginPath(); g.moveTo(side * (30 + k * 8), -128); g.quadraticCurveTo(x + (R() - 0.5) * 12, -20, x + side * 10, 160); g.stroke();
      }
      g.lineWidth = 3;
      for (let i = 0; i < 5; i++) { const x = -26 + i * 13; g.beginPath(); g.moveTo(x, -125); g.quadraticCurveTo(x + (R() - 0.5) * 10, -80, x + (R() - 0.5) * 16, -50); g.stroke(); }
    }
  }
}
// wajah kamera si pemain hantu, dibuat menyeramkan: hitam-putih kontras, mata menghitam, merah
function drawCamFace(g, img, t) {
  g.save();
  g.beginPath(); g.ellipse(0, 0, 120, 140, 0, 0, Math.PI * 2); g.clip();
  g.filter = 'grayscale(1) contrast(2.2) brightness(0.75)';
  const sq = 1 + Math.sin(t * 40) * 0.03;
  g.drawImage(img, -130 * sq, -150, 260 * sq, 300);
  g.filter = 'none';
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#c03030'; g.fillRect(-140, -160, 280, 320);
  g.globalCompositeOperation = 'source-over';
  for (const x of [-38, 38]) { g.fillStyle = 'rgba(0,0,0,.85)'; g.beginPath(); g.ellipse(x, -30, 24, 18, 0, 0, Math.PI * 2); g.fill(); eyeGlow(g, x, -30, 8, '#ff2020', 'rgba(255,0,0,0)'); }
  g.restore();
}
function drawScare(dt) {
  if (G.scareActive <= 0) return;
  G.scareActive -= dt;
  const t = 1.5 - G.scareActive, w = scareCanvas.width, h = scareCanvas.height, g = sctx;
  if (G.scareActive <= 0) { scareCanvas.hidden = true; return; }
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const scale = 0.7 + Math.min(1, t * 3) * 0.9 + t * 0.15;
  const k = 1.2 - t / 1.5;
  g.save();
  g.translate(w / 2 + (Math.random() - 0.5) * 30 * k, h / 2 + (Math.random() - 0.5) * 30 * k + 10); g.scale(scale, scale);
  const gf = G.mode === 'versus' ? faces.get(G.ghostId) : null;
  if (gf && gf.img && gf.img.complete && gf.img.naturalWidth) drawCamFace(g, gf.img, t);
  else drawFace(g, G.scareType, t);
  g.restore();
  g.fillStyle = `rgba(150,0,0,${0.12 + Math.random() * 0.12})`; g.fillRect(0, 0, w, h);
  if (Math.random() < 0.5) for (let i = 0; i < 2; i++) { const y = Math.random() * h; g.drawImage(scareCanvas, 0, y, w, 4, (Math.random() - 0.5) * 24, y, w, 4); }
  scareCanvas.style.opacity = Math.min(1, G.scareActive * 2);
}

// ======================= LAMPU =======================
let lampAcc = 0;
function updateLamps(dt) {
  if (!W.lamps.length) return;
  lampAcc -= dt;
  const camX = camera.position.x, camZ = camera.position.z;
  const col = new THREE.Color(), base = new THREE.Color(W.map.lamp);
  W.lamps.forEach((l, i) => {
    let lv = 1;
    const gd = Math.hypot(l.x - ghost.x, l.z - ghost.z);
    if (l.broken) lv = Math.sin(G.time * 13 + l.phase) > 0.6 ? 0.15 : (Math.random() < 0.04 ? 0.1 : 0.9);
    if (l.flickerT > 0) { l.flickerT -= dt; lv = Math.random() < 0.5 ? 0 : 1; }
    if (ghost.vis && gd < 5) lv *= Math.random() < 0.6 ? 0.05 : 0.6;
    l.level = lv;
    col.copy(base).multiplyScalar(0.25 + lv * 0.9);
    W.lampMesh.setColorAt(i, col);
  });
  if (W.lampMesh.instanceColor) W.lampMesh.instanceColor.needsUpdate = true;
  if (lampAcc <= 0) {
    lampAcc = 0.25;
    const sorted = [...W.lamps].sort((a, b) => Math.hypot(a.x - camX, a.z - camZ) - Math.hypot(b.x - camX, b.z - camZ));
    lampPool.forEach((pl, i) => { pl.userData.lamp = sorted[i] || null; if (sorted[i]) pl.position.set(sorted[i].x, WALL_H - 0.3, sorted[i].z); });
  }
  lampPool.forEach(pl => { pl.intensity = pl.userData.lamp ? 8 * pl.userData.lamp.level : 0; });
}

// ======================= KAMERA & VISUAL =======================
function updateView(dt) {
  const m = me();
  if (!m) return;
  let viewP = m;
  const spectating = m.state === 'caught' || m.state === 'escaped';
  if (spectating) {
    const others = [...G.players.values()].filter(p => p.state === 'alive');
    if (others.length) viewP = others[G.spectateIdx % others.length];
    $('spectate').hidden = false;
    $('spectate').textContent = others.length ? `Menonton ${viewP.name} · klik untuk ganti` : 'Menunggu permainan selesai…';
  } else $('spectate').hidden = true;
  const ghostView = viewP.state === 'ghost';
  if (!G.intro) {
    const eye = ghostView ? GHOST_EYE : viewP.hid ? 1.45 : EYE;
    const bob = viewP === m && !m.hid ? Math.sin(m.bob || 0) * (m.sp ? 0.06 : 0.035) : 0;
    camera.position.set(viewP.x, eye + bob, viewP.z);
    camera.rotation.set(viewP === m ? m.pitch : 0, viewP.ry, 0);
    const flOn = viewP.fl && viewP.state === 'alive' && !viewP.hid;
    let fi = flOn ? 26 : 0;
    if (flOn && viewP.battery < 0.15 && Math.random() < 0.15) fi *= 0.2;
    flash.intensity = fi;
  }
  hemi.intensity = ghostView ? 2.2 : W.map.ambient[2];
  hemi.color.set(ghostView ? 0x803030 : W.map.ambient[0]);

  let si = 0;
  for (const p of G.players.values()) {
    if (p.id === G.myId) continue;
    p.x = lerp(p.x, p.tx, Math.min(1, dt * 12)); p.z = lerp(p.z, p.tz, Math.min(1, dt * 12));
    if (p.mesh) {
      p.mesh.visible = p.state === 'alive' && !p.hid && p !== viewP;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.ry;
      p.mesh.userData.glow.visible = p.fl;
    }
    if (remoteSpots[si] && p.state === 'alive' && p.fl && !p.hid && p !== viewP) {
      const s = remoteSpots[si++];
      s.intensity = 18; s.position.set(p.x, 1.3, p.z);
      s.target.position.set(p.x - Math.sin(p.ry) * 3, 1.0, p.z - Math.cos(p.ry) * 3);
    }
  }
  for (; si < remoteSpots.length; si++) remoteSpots[si].intensity = 0;

  // hantu
  if (!isAuth()) { ghost.x = lerp(ghost.x, ghost.tx, Math.min(1, dt * 10)); ghost.z = lerp(ghost.z, ghost.tz, Math.min(1, dt * 10)); }
  ghost.anim += dt;
  ghostMesh.visible = ghost.vis && !iAmGhost();
  let gy = 0.05 + Math.sin(ghost.anim * 2.2) * 0.06;
  if (G.gtype === 'pocong') gy = Math.abs(Math.sin(ghost.anim * 6.3)) * 0.35;
  if (G.gtype === 'anak') gy = Math.abs(Math.sin(ghost.anim * 9)) * 0.05;
  if (G.gtype === 'genderuwo') gy = Math.abs(Math.sin(ghost.anim * 5)) * 0.04;
  ghostMesh.position.set(ghost.x, gy, ghost.z);
  ghostMesh.rotation.y = ghost.ry;
  ghostMesh.rotation.x = ghost.state === 'chase' ? 0.12 : 0.03;
  ghostMesh.userData.arms.forEach((a, i) => { a.rotation.x = (G.gtype === 'kunti' ? -1.1 : G.gtype === 'genderuwo' ? -0.4 : -0.25) + Math.sin(ghost.anim * 3 + i) * 0.15; });
  // Sosok Bayangan: hampir tak terlihat kecuali disorot senter atau sangat dekat
  if (ghostMesh.userData.shadow) {
    const dx = ghost.x - camera.position.x, dz = ghost.z - camera.position.z, d = Math.hypot(dx, dz);
    const fx = -Math.sin(camera.rotation.y), fz = -Math.cos(camera.rotation.y);
    const lit = flash.intensity > 0 && d < 16 && (dx * fx + dz * fz) / Math.max(0.01, d) > 0.88;
    setGhostOpacity(ghostMesh, lit || d < 2.5 ? 1 : 0.1);
  }

  W.items.forEach((it, i) => { if (!it.taken) { it.mesh.rotation.y += dt * 1.5; it.mesh.position.y = 0.8 + Math.sin(G.time * 2 + i) * 0.08; } });

  let dread = 0;
  if (!ghostView && m.state === 'alive' && ghost.vis && !G.intro) {
    const d = Math.hypot(m.x - ghost.x, m.z - ghost.z);
    dread = clamp(1 - d / 13, 0, 1);
    if (dread > 0 && !lineOfSight(m.x, m.z, ghost.x, ghost.z)) dread *= 0.55;
  }
  sfx.setDread(dread);
  sfx.tickHeart(dt, dread);
  $('redpulse').style.opacity = dread > 0.3 ? (dread - 0.3) * (0.7 + Math.sin(G.time * 8) * 0.3) : 0;
}

// ======================= HUD =======================
let toastT = 0;
function toast(text, sec = 2.5) { $('toast').textContent = text; $('toast').style.opacity = 1; toastT = sec; }
let hudAcc = 0;
function updateHud(dt) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  hudAcc -= dt;
  if (hudAcc > 0) return;
  hudAcc = 0.1;
  const m = me();
  if (!m) return;
  const n = W.items.filter(x => x.taken).length, total = W.items.length;
  const sub = `${escapeHtml(W.map.name)} · ${escapeHtml(D().name)}${G.mode === 'versus' ? '' : ' · Hantu: ' + escapeHtml(GT().name)}${m.lives > 1 ? ' · ❤❤' : ''}`;
  if (iAmGhost()) {
    const left = [...G.players.values()].filter(p => p.state === 'alive').length;
    const wait = Math.ceil(INTRO - G.time);
    $('obj').innerHTML = `<div class="big">Kamu HANTU (${escapeHtml(GT().name)})</div>${wait > 0 ? `Dilepas dalam ${wait} detik…` : `Tangkap ${left} pemain tersisa · <b>E</b> periksa lemari`}<br>${escapeHtml(W.map.item.name)}: ${n}/${total}${G.exitOpen ? ' · <b style="color:#ff6060">PINTU TERBUKA!</b>' : ''}`;
  } else if (m.state === 'alive') {
    const wait = G.role !== 'solo' && G.time < INTRO - 0.5 ? `<br>Menunggu yang lain… ${Math.ceil(INTRO - 0.5 - G.time)}` : '';
    $('obj').innerHTML = (G.exitOpen
      ? `<div class="big">Pintu keluar terbuka!</div>Lari ke pintu bertanda KELUAR.`
      : `<div class="big">${escapeHtml(W.map.item.name)}: ${n}/${total}</div>Cari petunjuk di catatan · <b>J</b> buku catatan`) + `<br><span style="color:#9a9284">${sub}</span>${wait}`;
  } else $('obj').innerHTML = m.state === 'escaped' ? '<div class="big">Kamu selamat</div>' : '<div class="big" style="color:#ff5060">Kamu tertangkap</div>';

  $('stam').style.width = (m.stamina * 100) + '%';
  $('bat').style.width = (m.battery * 100) + '%';
  $('hiddenOverlay').hidden = !m.hid;
  if (G.mode === 'versus') { const t = Math.ceil(G.vtime); $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  let prompt = '';
  if (!overlayOpen() && ((m.state === 'alive' && !m.hid) || iAmGhost())) {
    const t = findTarget(m);
    if (t) prompt = {
      item: `<b>E</b> ambil ${escapeHtml(W.map.item.name)}`, note: '<b>E</b> baca catatan', locker: '<b>E</b> sembunyi di lemari',
      search: `<b>E</b> geledah ${SEARCH_NAMES[t.ch] ?? 'barang'}`, check: '<b>E</b> periksa lemari',
    }[t.type] || '';
  }
  $('prompt').hidden = !prompt; $('prompt').innerHTML = prompt;
  if (G.players.size > 1) {
    const ico = { alive: '🟢', caught: '💀', escaped: '🚪', ghost: '👻' };
    $('team').innerHTML = [...G.players.values()].map(p => `${ico[p.state] || ''} ${escapeHtml(p.name)}${p.id === G.myId ? ' (kamu)' : ''}`).join('<br>');
  } else $('team').innerHTML = '';
  $('clickPlay').hidden = locked || overlayOpen() || G.ended || G.screen !== 'play';
}
function spectateNext() { const m = me(); if (m && (m.state === 'caught' || m.state === 'escaped')) G.spectateIdx++; }

// ======================= LAYAR / MENU =======================
function showScreen(name) {
  G.screen = name;
  for (const id of ['menu', 'join', 'lobby', 'end']) $(id).hidden = id !== name;
  $('hud').hidden = name !== 'play';
  $('pause').hidden = true;
  if (name !== 'play') { $('intro').hidden = true; $('paper').hidden = true; $('journal').hidden = true; G.intro = null; G.reading = -1; G.journal = false; }
  G.menuOpen = false;
  if (name !== 'play' && document.pointerLockElement) document.exitPointerLock();
  if (name !== 'play') sfx.setDread(0);
}
function openPause() {
  if (G.screen !== 'play' || G.ended) return;
  G.menuOpen = true;
  if (G.role === 'solo') G.paused = true;
  $('pauseSub').textContent = G.role === 'solo' ? 'Permainan dijeda.' : 'Permainan tetap berjalan untuk pemain lain - hati-hati!';
  $('pause').hidden = false;
}
function closePause() { G.menuOpen = false; G.paused = false; $('pause').hidden = true; sfx.unlock(); requestLock(); }

function renderMapCards(el, selected, onPick, enabled = true) {
  el.innerHTML = '';
  MAPS.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'opt' + (i === selected ? ' sel' : '') + (enabled ? '' : ' dis');
    d.innerHTML = `<b>${m.name}</b><span>${m.desc}</span>`;
    if (enabled) d.onclick = () => onPick(i);
    el.appendChild(d);
  });
}
function renderDiffCards(el, selected, onPick, enabled = true) {
  el.innerHTML = '';
  for (const [k, d] of Object.entries(DIFF)) {
    const c = document.createElement('div');
    c.className = 'opt' + (k === selected ? ' sel' : '') + (enabled ? '' : ' dis');
    c.innerHTML = `<b>${d.name}</b><span>${d.desc}</span>`;
    if (enabled) c.onclick = () => onPick(k);
    el.appendChild(c);
  }
}
function fillGhostSelect(sel, value, enabled = true) {
  sel.innerHTML = `<option value="acak">🎲 Acak (kejutan)</option>` + GHOST_KEYS.map(k => `<option value="${k}">${GHOSTS[k].name}</option>`).join('');
  sel.value = value;
  sel.disabled = !enabled;
}
function renderMenu() {
  document.querySelectorAll('#modes .opt').forEach(o => { o.classList.toggle('sel', o.dataset.mode === settings.mode); o.onclick = () => { settings.mode = o.dataset.mode; store.set('mode', settings.mode); renderMenu(); }; });
  renderMapCards($('maps'), settings.map, (i) => { settings.map = i; store.set('map', i); renderMenu(); });
  renderDiffCards($('diffs'), settings.diff, (k) => { settings.diff = k; store.set('diff', k); renderMenu(); });
  fillGhostSelect($('ghostTypeSel'), settings.gtype);
  $('ghostDesc').textContent = settings.gtype === 'acak' ? 'Hantu dipilih acak tiap permainan.' : GHOSTS[settings.gtype].desc;
  const solo = settings.mode === 'solo';
  $('btnSolo').hidden = !solo; $('btnHost').hidden = solo; $('btnJoin').hidden = solo; $('btnFw').hidden = solo;
  $('btnCloseGame').hidden = !hasBridge;
  if (!hasBridge && !solo) $('menuMsg').textContent = 'Multiplayer hanya tersedia di dalam ZeenIQ Dev Tools.';
}
function renderLobby() {
  const host = G.role === 'host';
  $('lobbyTitle').textContent = host ? 'Room Kamu (Host)' : 'Lobby';
  const ips = (G.hostIps || []).slice(0, 3).map(a => `${a.wifi ? 'Wi-Fi' : escapeHtml(a.name)} <b>${a.ip}</b>`).join(' · ');
  $('lobbySub').innerHTML = host ? `Bagikan IP ke teman: ${ips || '(tidak ada jaringan)'}` : 'Menunggu host memulai permainan…';
  const pl = $('plist'); pl.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = G.lobby[i];
    const d = document.createElement('div');
    d.className = 'pslot' + (p ? ' on' : '');
    const isGhost = G.mode === 'versus' && p && G.ghostChoice === p.id;
    const fimg = p && faces.get(p.id)?.url ? `<img src="${faces.get(p.id).url}" alt="">` : '';
    d.innerHTML = p ? fimg + `<div class="nm" style="color:#${COLORS[p.id % 4].toString(16).padStart(6, '0')}">${escapeHtml(p.name)}</div>${p.id === 0 ? 'Host' : 'Pemain'}${p.id === G.myId ? ' · kamu' : ''}${isGhost ? '<div class="ghost">👻 Hantu</div>' : ''}` : 'kosong';
    pl.appendChild(d);
  }
  document.querySelectorAll('#lModes .opt').forEach(o => {
    o.classList.toggle('sel', o.dataset.mode === G.mode);
    o.classList.toggle('dis', !host);
    o.onclick = host ? () => { G.mode = o.dataset.mode; renderLobby(); broadcastLobby(); } : null;
  });
  renderMapCards($('lMaps'), G.mapIdx, (i) => { G.mapIdx = i; renderLobby(); broadcastLobby(); }, host);
  renderDiffCards($('lDiffs'), G.diff, (k) => { G.diff = k; renderLobby(); broadcastLobby(); }, host);
  fillGhostSelect($('lGhostTypeSel'), G.gtypeChoice, host);
  $('ghostPick').hidden = G.mode !== 'versus';
  const gs = $('ghostSel');
  gs.innerHTML = `<option value="-1">Acak</option>` + G.lobby.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  gs.value = String(G.ghostChoice);
  gs.disabled = !host;
  $('btnStart').hidden = !host;
  const need = G.mode === 'versus' ? 2 : 1;
  $('btnStart').disabled = G.lobby.length < need;
  $('btnStart').textContent = G.lobby.length < need ? 'Versus butuh minimal 2 pemain' : 'Mulai ▶';
}
function renderHosts(list, error) {
  const el = $('hostList');
  if (G.screen !== 'join') return;
  el.innerHTML = list.length ? '' : `<div class="sub">${error ? 'Pencarian otomatis tidak tersedia (' + escapeHtml(error) + ') - ketik IP host.' : 'Belum ada room ditemukan… pastikan teman sudah membuat room dan berada di jaringan yang sama.'}</div>`;
  for (const h of list) {
    const d = document.createElement('div');
    const can = h.state === 'lobby' && h.players < 4;
    d.className = 'opt' + (can ? '' : ' dis');
    d.innerHTML = `<div><b>${escapeHtml(h.name)}</b><span>${escapeHtml(h.ip)} · ${escapeHtml(h.info)}</span></div><div>${h.state === 'lobby' ? (h.players >= 4 ? 'Penuh' : `${h.players}/4 · Gabung ▶`) : 'Sedang main'}</div>`;
    if (can) d.onclick = () => { $('joinMsg').textContent = `Menyambung ke ${h.ip}…`; bridge({ cmd: 'join', ip: h.ip, port: h.port, name: settings.name }); };
    el.appendChild(d);
  }
}
function showEnd(data) {
  showScreen('end');
  const mine = data.list.find(p => p.id === G.myId);
  const titles = { escaped: 'KALIAN SELAMAT', caught: 'TERTANGKAP…', survivors: 'PARA PEMAIN MENANG', ghost: 'HANTU MENANG', ghostleft: 'Hantu keluar dari permainan' };
  let title = titles[data.result] || 'Selesai';
  if (G.mode === 'solo') title = data.result === 'escaped' ? 'KAMU SELAMAT' : 'KAMU TERTANGKAP…';
  $('endTitle').textContent = title;
  $('endSub').textContent = `${MAPS[G.mapIdx].name} · ${MODE_NAME[G.mode]} · ${D().name} · ${G.mode === 'versus' ? '' : GT().name + ' · '}${Math.floor(data.time / 60)} menit ${data.time % 60} detik`;
  const lbl = { escaped: '🚪 Kabur', caught: '💀 Tertangkap', alive: '…', ghost: '👻 Hantu' };
  $('endList').innerHTML = G.mode === 'solo' ? '' : data.list.map(p => `${lbl[p.state] || p.state} — ${escapeHtml(p.name)}${p.id === G.myId ? ' (kamu)' : ''}`).join('<br>');
  $('btnAgain').hidden = G.role === 'client';
  $('endMsg').textContent = G.role === 'client' ? 'Menunggu host…' : '';
  if (mine && mine.state === 'escaped') sfx.win();
}
function leaveToMenu(msg) {
  bridge({ cmd: 'leave' });
  bridge({ cmd: 'discover', on: false });
  G.role = 'none'; G.lobby = [];
  for (const id of [...faces.keys()]) if (id !== G.myId) setFace(id, '');
  showScreen('menu');
  renderMenu();
  setMsg(msg || '');
}
function startSolo() {
  sfx.unlock();
  settings.name = cleanName($('nameIn').value);
  G.role = 'solo'; G.myId = 0;
  startGame(makeStartConfig('solo', settings.map, [{ id: 0, name: settings.name }], -1, settings.diff, settings.gtype));
}

// tombol-tombol
$('nameIn').value = settings.name;
$('nameIn').addEventListener('input', () => { settings.name = cleanName($('nameIn').value); store.set('name', settings.name); });
$('qualSel').value = settings.quality;
$('qualSel').addEventListener('change', () => { store.set('quality', $('qualSel').value); location.reload(); });
for (const id of ['volIn', 'vol2In']) {
  $(id).value = settings.volume;
  $(id).addEventListener('input', (e) => { settings.volume = +e.target.value; store.set('volume', settings.volume); sfx.setVolume(settings.volume / 100); $('volIn').value = $('vol2In').value = settings.volume; });
}
$('sensIn').value = settings.sens;
$('sensIn').addEventListener('input', (e) => { settings.sens = +e.target.value; store.set('sens', settings.sens); });
$('ghostTypeSel').addEventListener('change', () => { settings.gtype = $('ghostTypeSel').value; store.set('gtype', settings.gtype); renderMenu(); });
$('lGhostTypeSel').addEventListener('change', () => { if (G.role !== 'host') return; G.gtypeChoice = $('lGhostTypeSel').value; renderLobby(); broadcastLobby(); });
$('btnSolo').onclick = startSolo;
$('btnHost').onclick = () => {
  sfx.unlock();
  if (!hasBridge) { setMsg('Multiplayer hanya tersedia di dalam ZeenIQ Dev Tools.'); return; }
  settings.name = cleanName($('nameIn').value);
  G.mode = settings.mode; G.mapIdx = settings.map; G.ghostChoice = -1; G.diff = settings.diff; G.gtypeChoice = settings.gtype;
  setMsg('Membuat room…');
  bridge({ cmd: 'host', name: settings.name });
};
$('btnJoin').onclick = () => {
  sfx.unlock();
  if (!hasBridge) { setMsg('Multiplayer hanya tersedia di dalam ZeenIQ Dev Tools.'); return; }
  settings.name = cleanName($('nameIn').value);
  showScreen('join');
  $('hostList').innerHTML = '<div class="sub">Mencari room…</div>';
  bridge({ cmd: 'discover', on: true });
};
$('btnFw').onclick = () => { setMsg('Meminta izin admin…'); bridge({ cmd: 'firewall' }); };
$('btnConnect').onclick = () => {
  const ip = $('ipIn').value.trim();
  if (!ip) { $('joinMsg').textContent = 'Ketik IP host dulu.'; return; }
  $('joinMsg').textContent = `Menyambung ke ${ip}…`;
  bridge({ cmd: 'join', ip, name: settings.name });
};
$('ipIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnConnect').click(); });
$('btnJoinBack').onclick = () => { bridge({ cmd: 'discover', on: false }); showScreen('menu'); renderMenu(); };
$('btnLeave').onclick = () => leaveToMenu('');
$('ghostSel').onchange = () => { G.ghostChoice = +$('ghostSel').value; renderLobby(); broadcastLobby(); };
$('btnStart').onclick = () => {
  if (G.role !== 'host') return;
  sfx.unlock();
  const cfg = makeStartConfig(G.mode, G.mapIdx, G.lobby, G.ghostChoice, G.diff, G.gtypeChoice);
  sendAll(cfg);
  startGame(cfg);
};
$('btnResume').onclick = closePause;
$('btnJournal').onclick = () => { $('pause').hidden = true; G.menuOpen = false; G.paused = false; toggleJournal(); };
document.querySelectorAll('.fsBtn').forEach(b => { b.onclick = toggleFullscreen; });
document.querySelectorAll('.camBtn').forEach(b => { b.onclick = () => setCamera(!Cam.on); });
$('btnCloseGame').onclick = () => { leaveToMenu(''); bridge({ cmd: 'fullscreen', on: false }); bridge({ cmd: 'close' }); };
$('btnQuit').onclick = () => {
  if (G.role === 'solo') { G.role = 'none'; showScreen('menu'); renderMenu(); }
  else leaveToMenu('');
};
$('btnAgain').onclick = () => {
  sfx.unlock();
  if (G.role === 'solo') startGame(makeStartConfig('solo', G.mapIdx, [{ id: 0, name: settings.name }], -1, settings.diff, settings.gtype));
  else if (G.role === 'host') { showScreen('lobby'); renderLobby(); broadcastLobby(); }
};
$('btnEndMenu').onclick = () => { if (G.role === 'solo') { G.role = 'none'; showScreen('menu'); renderMenu(); } else leaveToMenu(''); };
window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && G.menuOpen && G.screen === 'play') { e.preventDefault(); closePause(); } });

// ======================= WAJAH DARI KAMERA (opsional) =======================
// Mati secara default & tidak diingat antar-sesi (privasi). Kalau dinyalakan: wajah
// diambil 3x/detik, dipotong kotak 80px, dipasang di kepala karakter, dan dikirim ke
// pemain lain di room yang sama lewat jaringan lokal. Tidak pernah disimpan.
const Cam = { on: false, stream: null, video: document.createElement('video'), canvas: document.createElement('canvas'), acc: 0, last: '', starting: false };
Cam.canvas.width = Cam.canvas.height = 80;
Cam.video.muted = true; Cam.video.playsInline = true;
const faces = new Map(); // id pemain -> { url, img, tex }
async function setCamera(on) {
  if (Cam.starting) return;
  if (on) {
    Cam.starting = true;
    $('camInfo').textContent = 'Membuka kamera…';
    try {
      Cam.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }, audio: false });
      Cam.video.srcObject = Cam.stream;
      await Cam.video.play();
      Cam.on = true;
      $('camInfo').textContent = 'Kamera menyala. Wajahmu tampil di karakter & terlihat teman di room yang sama.';
    } catch (e) {
      Cam.on = false;
      $('camInfo').textContent = 'Kamera tidak bisa dibuka (' + (e && e.name === 'NotAllowedError' ? 'izin ditolak' : e && e.name === 'NotFoundError' ? 'tidak ada kamera' : (e?.message || 'error')) + ').';
    }
    Cam.starting = false;
  } else {
    Cam.stream?.getTracks().forEach(t => t.stop());
    Cam.stream = null; Cam.on = false; Cam.last = '';
    setFace(G.myId, '');
    shareFace('');
    $('camInfo').textContent = 'Kamera mati.';
  }
  updateCamUi();
}
function updateCamUi() {
  document.querySelectorAll('.camBtn').forEach(b => { b.textContent = `📷 Wajah dari kamera: ${Cam.on ? 'Nyala' : 'Mati'}`; b.classList.toggle('pri', Cam.on); });
  if (!Cam.on) { const g = $('camPreview').getContext('2d'); g.fillStyle = '#140d10'; g.fillRect(0, 0, 44, 44); }
  $('mirror').hidden = !Cam.on;
}
function captureFace() {
  const v = Cam.video;
  if (!Cam.on || v.readyState < 2 || !v.videoWidth) return '';
  const s = Math.min(v.videoWidth, v.videoHeight) * 0.8, sx = (v.videoWidth - s) / 2, sy = (v.videoHeight - s) / 2.4;
  const g = Cam.canvas.getContext('2d');
  g.save();
  g.translate(80, 0); g.scale(-1, 1); // cermin, seperti melihat diri sendiri
  g.filter = 'contrast(1.15) brightness(0.92) saturate(0.7)';
  g.drawImage(v, sx, sy, s, s, 0, 0, 80, 80);
  g.restore();
  $('camPreview').getContext('2d').drawImage(Cam.canvas, 0, 0, 44, 44);
  if (!$('mirror').hidden) $('mirror').getContext('2d').drawImage(Cam.canvas, 0, 0, 96, 96);
  return Cam.canvas.toDataURL('image/jpeg', 0.55);
}
function shareFace(url) {
  if (G.role === 'host') sendAll({ t: 'face', id: G.myId, img: url });
  else if (G.role === 'client') sendHost({ t: 'face', img: url });
}
function camTick(dt) {
  if (!Cam.on) return;
  Cam.acc += dt;
  if (Cam.acc < 1 / 3) return;
  Cam.acc = 0;
  const url = captureFace();
  if (!url) return;
  setFace(G.myId, url);
  if (G.screen === 'play' || G.screen === 'lobby') shareFace(url);
}
// pasang / perbarui / hapus wajah seorang pemain
function setFace(id, url) {
  let f = faces.get(id);
  if (!url) {
    if (f) { faces.delete(id); f.tex?.dispose(); }
    applyFaceToModels(id);
    if (G.screen === 'lobby') renderLobby();
    return;
  }
  if (!f) { f = { url: '', img: new Image(), tex: null }; faces.set(id, f); }
  const first = !f.url;
  f.url = url;
  const img = new Image();
  img.onload = () => {
    f.img = img;
    if (!f.tex) { f.tex = new THREE.Texture(img); f.tex.colorSpace = THREE.SRGBColorSpace; }
    else f.tex.image = img;
    f.tex.needsUpdate = true;
    if (first) { applyFaceToModels(id); if (G.screen === 'lobby') renderLobby(); }
  };
  img.src = url;
}
// lempeng wajah di depan kepala avatar (dan di kepala hantu kalau pemain itu hantunya)
function facePlate(group, y, z, r) {
  if (group.userData.facePlate) return group.userData.facePlate;
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: 0xb8b8b8, transparent: true }));
  m.position.set(0, y, z);
  m.visible = false;
  group.add(m);
  group.userData.facePlate = m;
  return m;
}
function applyFaceToModels(id) {
  const f = faces.get(id);
  const p = G.players.get(id);
  const targets = [];
  if (p?.mesh) targets.push(p.mesh);
  if (G.mode === 'versus' && id === G.ghostId && ghostMesh) targets.push(ghostMesh);
  for (const model of targets) {
    const h = model.userData.head || { y: 1.6, z: -0.172, r: 0.15 };
    const plate = facePlate(model, h.y, h.z, h.r);
    if (h.flip) plate.rotation.y = Math.PI;
    plate.material.map = f?.tex || null;
    plate.material.needsUpdate = true;
    plate.visible = !!(f && f.tex);
  }
}

// ======================= LOOP UTAMA =======================
let last = performance.now(), lastRaf = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  lastRaf = performance.now();
  tick(now, true);
}
// Halaman tidak terlihat (pindah tab aplikasi / jendela diminimalkan): browser menghentikan
// requestAnimationFrame. Di multiplayer itu akan membekukan permainan semua orang (host =
// wasit), jadi logikanya tetap dijalankan timer ini - tanpa menggambar.
setInterval(() => {
  const now = performance.now();
  if (now - lastRaf > 120 && (G.role === 'host' || G.role === 'client')) tick(now, false);
}, 33);
function tick(now, render) {
  const dt = Math.min(0.05, (now - last) / 1000);
  if (dt <= 0) return;
  last = now;
  if (G.screen === 'play' && W.group) {
    if (G.intro) updateIntro(dt);
    if (!G.paused) {
      updateLocal(dt);
      if (isAuth()) authorityTick(dt); else G.time += dt;
      randomScares(dt);
      ghostAmbience(dt);
    }
    updateView(dt);
    updateLamps(dt);
    if (!G.intro) updateHud(dt);
    if (render) drawScare(dt);
    G.sendAcc += dt;
    if (G.sendAcc >= 1 / 15) {
      G.sendAcc = 0;
      const m = me();
      if (G.role === 'host') sendSnapshot();
      else if (G.role === 'client' && m) sendHost({ t: 'pose', x: +m.x.toFixed(2), z: +m.z.toFixed(2), ry: +m.ry.toFixed(2), fl: m.fl ? 1 : 0, sp: m.sp ? 1 : 0, hid: m.hid ? 1 : 0, hc: m.hidCell, sx: m.saved?.x, sz: m.saved?.z });
    }
    if (render) renderer.render(scene, camera);
  } else if (render && (G.screen === 'menu' || G.screen === 'lobby' || G.screen === 'join' || G.screen === 'end')) {
    menuBackdrop(dt);
    drawScare(dt);
  }
  if (render || G.role === 'host' || G.role === 'client') camTick(dt);
  if (G.role === 'host') {
    G.beaconAcc -= dt;
    if (G.beaconAcc <= 0) { G.beaconAcc = 2; bridge({ cmd: 'beacon', name: settings.name, state: G.screen === 'play' && !G.ended ? 'main' : 'lobby', info: `${MODE_NAME[G.mode]} · ${MAPS[G.mapIdx].name} · ${D().name} · ${G.lobby.length}/4` }); }
  }
}
// latar menu: lorong gelap, sesekali ada sosok lewat
let bdT = 0;
function menuBackdrop(dt) {
  if (W.map !== MAPS[0] || !ghostMesh) {
    buildWorld(0);
    setGhostModel(GHOST_KEYS[Math.floor(Math.random() * GHOST_KEYS.length)]);
    G.players.clear();
  }
  bdT += dt;
  camera.position.set(center(12) + Math.sin(bdT * 0.1) * 1.5, EYE, center(10) + Math.cos(bdT * 0.13) * 1.2);
  camera.rotation.set(Math.sin(bdT * 0.2) * 0.05, bdT * 0.05, 0);
  flash.intensity = 0;
  ghost.vis = true; ghost.x = center(12); ghost.z = center(13); ghost.anim += dt;
  ghostMesh.visible = Math.sin(bdT * 0.7) > 0.85;
  ghostMesh.position.set(ghost.x, 0.05, ghost.z);
  if (ghostMesh.userData.shadow) setGhostOpacity(ghostMesh, 1);
  updateLamps(dt);
  renderer.render(scene, camera);
}

renderMenu();
updateFsButtons();
updateCamUi();
bridge({ cmd: 'info' });
requestAnimationFrame(frame);
// dipakai alat uji otomatis
window.__horror = { G, W, ghost, startGame, makeStartConfig, MAPS, settings, endIntro, DIFF, GHOSTS, findTarget, openPaper };
