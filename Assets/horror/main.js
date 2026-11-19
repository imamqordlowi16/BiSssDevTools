// MALAM TERAKHIR - game horor 3D first-person (tab 🎃 Horor ZeenIQ Dev Tools).
//
// Mode: solo, co-op (2-4, hantu AI), versus (2-4, satu pemain jadi hantu).
// Jaringan lewat C# (Horror/HorrorGameView.cs): game ini mengirim {cmd} ke C# dan
// menerima {ev}. Host = wasit: AI hantu, item, siapa tertangkap, kapan selesai.
// Ringan: MeshLambert, tanpa bayangan, InstancedMesh, jumlah lampu tetap & kecil,
// tekstur kecil (128px) digambar di kode, kabut menutup jarak pandang.
import * as THREE from './lib/three.module.min.js';
import { MAPS, SOLID, BLOCKS_SIGHT, reachable } from './maps.js';
import { Sfx } from './audio.js';

// ======================= UTIL =======================
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const CELL = 2, WALL_H = 3, EYE = 1.6, GHOST_EYE = 2.0, PR = 0.3;
const COLORS = [0x3a7bd5, 0xd53a3a, 0x3ad57b, 0xd5b83a];
const MODE_NAME = { solo: 'Solo', coop: 'Co-op', versus: 'Versus' };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const store = {
  get(k, d) { try { const v = localStorage.getItem('mt.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mt.' + k, JSON.stringify(v)); } catch { } },
};
function cleanName(s) { s = (s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14); return s || 'Pemain'; }

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
};
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
// Senter pemain lain (hanya kualitas tinggi)
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
        for (let y = 0; y < s; y += 16) for (let x = 0; x < s; x += 16) {
          g.fillStyle = (x + y) % 32 ? p.wall : p.wall2; g.fillRect(x + 1, y + 1, 14, 14);
        }
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
function glowTexture(color) {
  return canvasTex((g, s) => {
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

// ======================= MODEL =======================
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
function makeGhostModel(tint = 0xcfc8bb) {
  const g = new THREE.Group();
  const dressMat = lambert(tint, { side: THREE.DoubleSide, emissive: 0x141414 });
  const skin = lambert(0xd8d0c4, { emissive: 0x1a1a1a });
  const hair = lambert(0x050505);
  const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.6, 1.55, 9, 1, true), dressMat);
  dress.position.y = 0.95; g.add(dress);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.5, 8), dressMat);
  torso.position.y = 1.8; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skin);
  head.scale.set(0.9, 1.2, 0.95); head.position.set(0, 2.17, 0.02); g.add(head);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.1, 10, 1, true, Math.PI * 0.15, Math.PI * 1.7), hair);
  back.material.side = THREE.DoubleSide; back.position.y = 1.85; back.rotation.y = Math.PI; g.add(back);
  for (let i = -2; i <= 2; i++) { // helai rambut menutupi wajah
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75 + Math.abs(i) * 0.1, 0.02), hair);
    s.position.set(i * 0.06, 1.95, 0.16); g.add(s);
  }
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false });
  for (const x of [-0.06, 0.06]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), eyeMat); e.position.set(x, 2.2, 0.15); g.add(e); }
  const arms = [];
  for (const x of [-0.22, 0.22]) {
    const a = new THREE.Group(); a.position.set(x, 1.95, 0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.95, 5), skin);
    m.position.y = -0.47; a.add(m);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.04), skin);
    hand.position.y = -1.0; a.add(hand);
    a.rotation.x = -1.0; g.add(a); arms.push(a);
  }
  g.userData.arms = arms;
  return g;
}
function makeAvatar(color, name) {
  const g = new THREE.Group();
  const mat = lambert(color);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.85, 3, 8), mat);
  body.position.y = 0.85; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), lambert(0xd9b38c));
  head.position.y = 1.6; g.add(head);
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 6), lambert(0x222222));
  torch.rotation.x = Math.PI / 2; torch.position.set(0.25, 1.2, -0.25); g.add(torch);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,240,210,1)'), blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(0.6, 0.6, 1); glow.position.set(0.25, 1.2, -0.38); g.add(glow);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(name, '#fff', 'rgba(0,0,0,.55)'), depthTest: false, fog: false }));
  tag.scale.set(1.0, 0.25, 1); tag.position.y = 2.05; g.add(tag);
  g.userData.glow = glow;
  return g;
}
function makeItemModel(kind) {
  const g = new THREE.Group();
  const gold = new THREE.MeshBasicMaterial({ color: kind === 'oldkey' ? 0xd8a640 : kind === 'key' ? 0xcfd6dc : kind === 'card' ? 0x7ad0ff : 0xff9a3a });
  if (kind === 'card') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), gold));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.04), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    strip.position.z = 0.05; g.add(strip);
  } else if (kind === 'fuse') {
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8), gold);
    glass.rotation.z = Math.PI / 2; g.add(glass);
    for (const x of [-0.13, 0.13]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 8), new THREE.MeshBasicMaterial({ color: 0x999999 })); cap.rotation.z = Math.PI / 2; cap.position.x = x; g.add(cap); }
  } else {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), gold);
    ring.position.x = -0.12; g.add(ring);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.03), gold); shaft.position.x = 0.04; g.add(shaft);
    for (const x of [0.1, 0.14]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.03), gold); t.position.set(x, -0.04, 0); g.add(t); }
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,210,120,1)'), blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(0.9, 0.9, 1); g.add(halo);
  return g;
}

// ======================= DUNIA =======================
const W = { group: null, grid: [], w: 0, h: 0, map: null, lamps: [], items: [], exit: null, doorMesh: null, sign: null, signOpen: null, signClosed: null, lampMesh: null, walk: [] };

function tileAt(cx, cz) { return (cx < 0 || cz < 0 || cx >= W.w || cz >= W.h) ? '#' : W.grid[cz][cx]; }
const isWall = (cx, cz) => { const t = tileAt(cx, cz); return t === '#' || t === 'X'; };
// arah membelakangi dinding terdekat (lemari/ranjang menempel ke dinding)
function faceFromWall(cx, cz) {
  if (isWall(cx, cz - 1)) return 0;            // dinding di utara -> menghadap selatan (+z)
  if (isWall(cx, cz + 1)) return Math.PI;
  if (isWall(cx - 1, cz)) return Math.PI / 2;
  if (isWall(cx + 1, cz)) return -Math.PI / 2;
  return 0;
}
function solidAt(cx, cz) { const ch = tileAt(cx, cz); return ch === 'X' ? !G.exitOpen : SOLID.has(ch); }
const cellOf = (v) => Math.floor(v / CELL);
const center = (c) => c * CELL + CELL / 2;
// lingkaran (pemain/hantu) menabrak sel padat? Perabot sedikit lebih kecil dari selnya.
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

function buildWorld(mapIdx) {
  if (W.group) { scene.remove(W.group); W.group.traverse(o => { o.geometry?.dispose(); }); }
  const map = MAPS[mapIdx];
  W.map = map; W.grid = map.grid; W.w = map.grid[0].length; W.h = map.grid.length;
  W.group = new THREE.Group(); scene.add(W.group);
  W.lamps = []; W.items = [];
  scene.fog = new THREE.FogExp2(map.fog, map.fogDensity * (settings.quality === 'low' ? 1.25 : 1));
  hemi.color.set(map.ambient[0]); hemi.groundColor.set(map.ambient[1]); hemi.intensity = map.ambient[2];
  const p = map.palette;
  const wallMat = lambert(0xffffff, { map: wallTexture(map) });
  const sizeX = W.w * CELL, sizeZ = W.h * CELL;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), lambert(0xffffff, { map: floorTexture(map, W.w, W.h) }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(sizeX / 2, 0, sizeZ / 2); W.group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), lambert(map.ceiling));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(sizeX / 2, WALL_H, sizeZ / 2); W.group.add(ceil);

  // --- Kumpulkan matriks per bagian model, lalu jadikan InstancedMesh (sedikit draw call) ---
  const parts = new Map();
  const mats = {
    wall: wallMat, prop: lambert(p.prop), prop2: lambert(p.prop2), metal: lambert(p.metal),
    sheet: lambert(map.id === 'rs' ? 0xc8ccc8 : 0x8a8270), dark: lambert(0x0c0c0c),
    locker: lambert(map.id === 'rumah' ? 0x2a1c12 : p.metal), lampOff: new THREE.MeshBasicMaterial({ color: 0xffffff }),
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
  // bagian model relatif terhadap pusat sel; (lx, lz) diputar sesuai arah perabot
  function putLocal(geom, mat, cx, cz, ry, lx, ly, lz) {
    const c = Math.cos(ry), s = Math.sin(ry);
    put(geom, mat, center(cx) + lx * c + lz * s, ly, center(cz) - lx * s + lz * c, ry);
  }
  const r = rng(mapIdx * 97 + 5);
  for (let cz = 0; cz < W.h; cz++) for (let cx = 0; cx < W.w; cx++) {
    const ch = W.grid[cz][cx];
    const x = center(cx), z = center(cz);
    switch (ch) {
      case '#': put(box(CELL, WALL_H, CELL), mats.wall, x, WALL_H / 2, z); break;
      case 'D': {
        put(box(CELL, 0.6, CELL), mats.wall, x, WALL_H - 0.3, z);
        const alongX = isWall(cx, cz - 1) && isWall(cx, cz + 1); // lorong arah x -> kusen di sumbu z
        const ry = alongX ? Math.PI / 2 : 0;
        putLocal(box(0.12, 2.4, 0.3), mats.prop, cx, cz, ry, -0.94, 1.2, 0);
        putLocal(box(0.12, 2.4, 0.3), mats.prop, cx, cz, ry, 0.94, 1.2, 0);
        if (map.id !== 'kantor' && r() < 0.8) putLocal(box(0.06, 2.3, 0.9), mats.prop, cx, cz, ry, -0.9, 1.15, 0.5); // daun pintu terbuka
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
      case 'L': W.lamps.push({ x, z, cx, cz, broken: r() < 0.35, phase: r() * 100, level: 1 }); break;
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
  // lampu langit-langit (warna per-instans dipakai untuk efek berkedip)
  W.lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.06, 0.7), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, W.lamps.length));
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
  const head = new THREE.Mesh(box(CELL, 0.5, CELL), wallMat); head.position.set(exX, WALL_H - 0.25, exZ); W.group.add(head);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(box(0.25, 2.5, CELL), wallMat); post.position.set(exX + (exRy ? 0 : s * 0.88), 1.25, exZ + (exRy ? s * 0.88 : 0)); post.rotation.y = exRy; W.group.add(post); }
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.5), new THREE.MeshBasicMaterial({ color: 0x8a9ab8, fog: false }));
  outside.position.set(exX - inwardX * 0.95, 1.25, exZ - inward * 0.95); outside.rotation.y = inwardX ? Math.PI / 2 * inwardX : (inward < 0 ? 0 : Math.PI); W.group.add(outside);
  W.doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.1), lambert(0x4a1010));
  W.doorMesh.position.set(exX + inwardX * 0.6, 1.25, exZ + inward * 0.6); W.doorMesh.rotation.y = exRy; W.group.add(W.doorMesh);
  W.signClosed = textTexture('TERKUNCI', '#ff3030', '#1a0000');
  W.signOpen = textTexture('KELUAR', '#30ff60', '#001a06');
  W.sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: W.signClosed, fog: false }));
  W.sign.position.set(exX + inwardX * 0.99, 2.75, exZ + inward * 0.99); W.sign.rotation.y = inwardX ? -Math.PI / 2 * inwardX : (inward < 0 ? 0 : Math.PI);
  if (inward < 0) W.sign.rotation.y = 0;
  W.group.add(W.sign);

  // sel lantai untuk tujuan jalan-jalan hantu
  const reach = reachable(W.grid, false);
  W.walk = [...reach].map(k => [k % W.w, (k / W.w) | 0]).filter(([x, z]) => !'SX'.includes(W.grid[z][x]));
}

function placeItems(cells) {
  W.items.forEach(it => W.group.remove(it.mesh));
  W.items = cells.map(([cx, cz]) => {
    const mesh = makeItemModel(W.map.item.kind);
    mesh.position.set(center(cx), 0.8, center(cz));
    W.group.add(mesh);
    return { cx, cz, mesh, taken: false };
  });
}

// ======================= STATE PERMAINAN =======================
const G = {
  screen: 'menu', role: 'none', myId: 0, mode: 'solo', mapIdx: 0, seed: 1,
  players: new Map(), ghostId: -1, exitOpen: false, itemsMask: 0, paused: false,
  time: 0, vtime: 0, ended: false, lobby: [], ghostChoice: -1, hostIps: [],
  sendAcc: 0, beaconAcc: 0, scareTimer: 30, scareActive: 0, endPending: null,
  spectateIdx: 0, menuOpen: false,
};
const ghost = { x: 0, z: 0, ry: 0, vis: true, state: 'idle', path: [], replan: 0, target: null, lastSeen: null, searchT: 0, cool: 8, awayT: 0, seenHide: new Set(), tx: 0, tz: 0, anim: 0 };
let ghostMesh = null, apparition = null;

function me() { return G.players.get(G.myId); }
const isAuth = () => G.role === 'solo' || G.role === 'host';
const ghostPlayer = () => (G.mode === 'versus' ? G.players.get(G.ghostId) : null);
const iAmGhost = () => G.mode === 'versus' && G.myId === G.ghostId;

function startGame(cfg) {
  G.mode = cfg.mode; G.mapIdx = cfg.map; G.seed = cfg.seed; G.ghostId = cfg.ghostId ?? -1;
  G.exitOpen = false; G.itemsMask = 0; G.time = 0; G.ended = false; G.endPending = null; G.paused = false; G.menuOpen = false;
  G.vtime = cfg.vtime || 0; G.scareTimer = 25 + Math.random() * 20; G.scareActive = 0; G.spectateIdx = 0;
  buildWorld(cfg.map);
  placeItems(cfg.items);
  W.sign.material.map = W.signClosed;
  W.doorMesh.visible = true;

  for (const p of G.players.values()) if (p.mesh) scene.remove(p.mesh);
  G.players.clear();
  cfg.players.forEach((p, i) => {
    const isG = G.mode === 'versus' && p.id === G.ghostId;
    const pl = { id: p.id, name: p.name, x: p.x, z: p.z, tx: p.x, tz: p.z, ry: Math.PI, pitch: 0, fl: !isG, sp: false, hid: false, hidCell: null, saved: null,
      state: isG ? 'ghost' : 'alive', color: COLORS[p.id % 4], mesh: null, stamina: 1, battery: 1, tired: false, stepT: 0 };
    if (p.id !== G.myId && !isG) { pl.mesh = makeAvatar(pl.color, p.name); scene.add(pl.mesh); }
    G.players.set(p.id, pl);
  });
  const m = me();
  camera.rotation.set(0, m.ry, 0);

  if (!ghostMesh) { ghostMesh = makeGhostModel(); scene.add(ghostMesh); apparition = makeGhostModel(0x9a948a); apparition.visible = false; scene.add(apparition); }
  const gc = findCell('G');
  Object.assign(ghost, { x: center(gc[0]), z: center(gc[1]), tx: center(gc[0]), tz: center(gc[1]), ry: 0, vis: true, state: 'idle', path: [], replan: 0, target: null, lastSeen: null, searchT: 0, cool: G.mode === 'versus' ? 0 : 8, awayT: 0, anim: 0 });
  ghost.seenHide = new Set();
  if (G.mode === 'versus') {
    const gp = ghostPlayer();
    if (gp) { gp.x = gp.tx = ghost.x; gp.z = gp.tz = ghost.z; }
  }
  ghostMesh.visible = !iAmGhost();

  showScreen('play');
  $('timer').hidden = G.mode !== 'versus';
  $('batBar').hidden = $('batLbl').hidden = iAmGhost();
  toast(iAmGhost() ? 'Kamu HANTU. Tangkap semua sebelum mereka kabur!' : W.map.exitText, 5);
  if (G.mode !== 'versus') setTimeout(() => { if (G.screen === 'play' && !G.ended) { toast('Ada sesuatu yang terbangun…', 3); sfx.randomScare('scrape'); } }, 7000);
  requestLock();
}
function findCell(ch) { for (let z = 0; z < W.h; z++) for (let x = 0; x < W.w; x++) if (W.grid[z][x] === ch) return [x, z]; return [1, 1]; }

// Host/solo: susun konfigurasi permainan baru
function makeStartConfig(mode, mapIdx, roster, ghostChoice) {
  const map = MAPS[mapIdx], seed = (Math.random() * 1e9) | 0, r = rng(seed);
  const ks = []; map.grid.forEach((row, z) => [...row].forEach((ch, x) => { if (ch === 'K') ks.push([x, z]); }));
  for (let i = ks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ks[i], ks[j]] = [ks[j], ks[i]]; }
  const nItems = mode === 'coop' && roster.length >= 3 ? 4 : 3;
  let ghostId = -1;
  if (mode === 'versus') ghostId = roster.some(p => p.id === ghostChoice) ? ghostChoice : roster[Math.floor(r() * roster.length)].id;
  // titik mulai: sel S + sel lantai di sekitarnya
  const grid = map.grid;
  const s = (() => { for (let z = 0; z < grid.length; z++) for (let x = 0; x < grid[0].length; x++) if (grid[z][x] === 'S') return [x, z]; })();
  const spots = [[0, 0], [0.6, 0], [0, 0.6], [0.6, 0.6]];
  const players = roster.map((p, i) => ({ id: p.id, name: p.name, x: center(s[0]) - 0.3 + spots[i % 4][0], z: center(s[1]) - 0.3 + spots[i % 4][1] }));
  return { t: 'start', mode, map: mapIdx, seed, items: ks.slice(0, nItems), ghostId, players, vtime: mode === 'versus' ? 420 : 0 };
}

// ======================= INPUT =======================
const keys = new Set();
let locked = false;
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (G.screen !== 'play') return;
  if (e.code === 'KeyF' && !e.repeat) toggleFlashlight();
  if (e.code === 'KeyE' && !e.repeat) interact();
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('mousemove', (e) => {
  if (!locked || G.screen !== 'play' || G.menuOpen) return;
  const m = me(); if (!m || m.hid) return;
  const s = settings.sens * 0.00018;
  m.ry -= e.movementX * s;
  m.pitch = clamp(m.pitch - e.movementY * s, -1.35, 1.35);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && G.screen === 'play' && !G.ended) openPause();
});
renderer.domElement.addEventListener('click', () => { if (G.screen === 'play' && !G.menuOpen) requestLock(); });
$('clickPlay').addEventListener('click', () => { sfx.unlock(); requestLock(); });
document.addEventListener('mousedown', () => { if (G.screen === 'play' && locked) spectateNext(); });
function requestLock() {
  try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch { }
}

function toggleFlashlight() {
  const m = me();
  if (!m || m.state !== 'alive' || m.hid || iAmGhost()) return;
  if (!m.fl && m.battery < 0.03) { toast('Baterai senter habis…', 1.5); return; }
  m.fl = !m.fl;
  sfx.flashlight();
}

function nearestLocker(m, maxD = 1.7) {
  let best = null, bd = maxD;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = cellOf(m.x) + dx, cz = cellOf(m.z) + dz;
    if (tileAt(cx, cz) !== 'H') continue;
    const d = Math.hypot(center(cx) - m.x, center(cz) - m.z);
    if (d < bd) { bd = d; best = [cx, cz]; }
  }
  return best;
}
function nearestItem(m, maxD = 1.6) {
  let best = -1, bd = maxD;
  W.items.forEach((it, i) => { if (it.taken) return; const d = Math.hypot(center(it.cx) - m.x, center(it.cz) - m.z); if (d < bd) { bd = d; best = i; } });
  return best;
}

function interact() {
  const m = me();
  if (!m || G.menuOpen) return;
  if (iAmGhost()) { // hantu memeriksa lemari
    const l = nearestLocker(m, 2.0);
    if (!l) return;
    sfx.locker();
    if (isAuth()) checkLocker(m.id, l); else sendHost({ t: 'check', cx: l[0], cz: l[1] });
    return;
  }
  if (m.state !== 'alive') return;
  if (m.hid) { // keluar dari lemari
    m.hid = false; m.x = m.saved.x; m.z = m.saved.z; m.hidCell = null;
    sfx.locker();
    return;
  }
  const i = nearestItem(m);
  if (i >= 0) {
    if (isAuth()) pickItem(m.id, i);
    else { sendHost({ t: 'pick', i }); W.items[i].mesh.visible = false; W.items[i].pendingUntil = G.time + 1.5; }
    return;
  }
  const l = nearestLocker(m);
  if (l) {
    m.saved = { x: m.x, z: m.z };
    m.hid = true; m.hidCell = l; m.fl = false;
    // di dalam lemari, mengintip keluar lewat celah pintunya
    const fr = faceFromWall(l[0], l[1]);
    m.x = center(l[0]) - Math.sin(fr) * 0.42; m.z = center(l[1]) - Math.cos(fr) * 0.42;
    m.ry = fr + Math.PI; m.pitch = 0;
    sfx.locker();
    if (isAuth()) noteHide(m);
  }
}

// ======================= PEMAIN LOKAL =======================
function updateLocal(dt) {
  const m = me();
  if (!m) return;
  const active = !G.menuOpen && !(G.paused);
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
      const speed = ghostP ? (m.sp ? 5.0 : 3.5) : (m.sp ? 5.4 : 2.8);
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
      }
    }
    // baterai senter
    if (m.state === 'alive') {
      if (m.fl) { m.battery = Math.max(0, m.battery - dt / 200); if (m.battery <= 0) { m.fl = false; toast('Senter mati - matikan sebentar untuk mengisi', 2); } }
      else m.battery = Math.min(1, m.battery + dt / 45);
    }
    // keluar lewat pintu
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
  if (ghost.cool > 0) { ghost.cool -= dt; ghost.vis = ghost.cool < 6 || ghost.state !== 'gone'; if (ghost.cool > 0) return; ghost.state = 'wander'; ghost.vis = true; }
  const sp = W.map.ghost;
  const alive = [...G.players.values()].filter(p => p.state === 'alive');
  if (!alive.length) return;
  // cari target: terlihat, atau terdengar lari
  let best = null, bestD = 1e9;
  for (const p of alive) {
    const d = Math.hypot(p.x - ghost.x, p.z - ghost.z);
    if (p.hid) {
      if (ghost.seenHide.has(p.id) && d < 22) { if (d < bestD) { best = p; bestD = d; } }
      continue;
    }
    const range = p.fl ? 15 : 8;
    const sees = d < range && lineOfSight(ghost.x, ghost.z, p.x, p.z);
    const hears = p.sp && d < 9;
    if ((sees || hears || d < 2.2) && d < bestD) { best = p; bestD = d; }
  }
  if (best) {
    if (ghost.state !== 'chase') sfx.stinger();
    ghost.state = 'chase'; ghost.target = best.id; ghost.lastSeen = [best.x, best.z]; ghost.searchT = 6;
  } else if (ghost.state === 'chase') { ghost.state = 'search'; }

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
      // jalan-jalan, condong mendekati pemain supaya tetap menegangkan
      const p = alive[Math.floor(Math.random() * alive.length)];
      const near = W.walk.filter(([x, z]) => Math.abs(x - cellOf(p.x)) + Math.abs(z - cellOf(p.z)) < 9);
      const pool = Math.random() < 0.65 && near.length ? near : W.walk;
      goal = pool[Math.floor(Math.random() * pool.length)];
    }
    ghost.path = bfsPath(cellOf(ghost.x), cellOf(ghost.z), goal[0], goal[1]) || [];
  }
  const speed = ghost.state === 'chase' ? sp.chase : sp.wander;
  if (ghost.state === 'chase' && ghost.target != null) {
    const p = G.players.get(ghost.target);
    // jarak dekat & terlihat: langsung terjang, tidak ikut grid
    if (p && !p.hid && Math.hypot(p.x - ghost.x, p.z - ghost.z) < 3 && lineOfSight(ghost.x, ghost.z, p.x, p.z)) {
      moveGhostToward(p.x, p.z, speed * dt);
      return;
    }
  }
  if (ghost.path.length) {
    const [nx, nz] = ghost.path[0];
    if (moveGhostToward(center(nx), center(nz), speed * dt)) ghost.path.shift();
  }
  // terlalu lama jauh dari semua pemain -> muncul di tempat lain (di luar pandangan)
  const minD = Math.min(...alive.map(p => Math.hypot(p.x - ghost.x, p.z - ghost.z)));
  ghost.awayT = minD > 18 ? ghost.awayT + dt : 0;
  if (ghost.awayT > 20) { ghost.awayT = 0; teleportGhost(alive); }
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
// pemain masuk lemari: kalau hantu sedang melihat, dia tahu
function noteHide(p) {
  if (G.mode === 'versus') return;
  const d = Math.hypot(p.x - ghost.x, p.z - ghost.z);
  if (ghost.state === 'chase' && d < 7 && lineOfSight(ghost.x, ghost.z, p.saved?.x ?? p.x, p.saved?.z ?? p.z)) ghost.seenHide.add(p.id);
  else ghost.seenHide.delete(p.id);
  if (ghost.target === p.id && !ghost.seenHide.has(p.id)) { ghost.state = 'search'; }
}

// ======================= ATURAN (host/solo) =======================
function pickItem(id, i) {
  const it = W.items[i], p = G.players.get(id);
  if (!it || it.taken || !p || p.state !== 'alive') return;
  // posisi terbaru yang dilaporkan (bukan posisi yang sedang dihaluskan) - jaringan ada jedanya
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
function catchPlayer(id, by) {
  const p = G.players.get(id);
  if (!p || p.state !== 'alive') return;
  p.state = 'caught'; p.hid = false;
  sendAll({ t: 'caught', id, by });
  onCaught(id);
  if (G.mode !== 'versus') { ghost.state = 'gone'; ghost.cool = 7; ghost.vis = false; ghost.seenHide.delete(id); ghost.path = []; setTimeout(() => { if (isAuth()) { const alive = [...G.players.values()].filter(q => q.state === 'alive'); if (alive.length) teleportGhost(alive); } }, 100); }
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
    if (gp) { ghost.x = gp.x; ghost.z = gp.z; ghost.ry = gp.ry + Math.PI; ghost.vis = true; }
    G.vtime = Math.max(0, G.vtime - dt);
  } else aiGhost(dt);
  // tertangkap
  const reach = G.mode === 'versus' ? 1.1 : 0.85;
  if (ghost.vis && ghost.cool <= 0) for (const p of G.players.values()) {
    if (p.state !== 'alive') continue;
    if (p.hid) {
      if (G.mode !== 'versus' && ghost.seenHide.has(p.id) && Math.hypot(center(p.hidCell[0]) - ghost.x, center(p.hidCell[1]) - ghost.z) < 1.6) catchPlayer(p.id, -1);
      continue;
    }
    if (Math.hypot(p.x - ghost.x, p.z - ghost.z) < reach) catchPlayer(p.id, G.mode === 'versus' ? G.ghostId : -1);
  }
  // selesai?
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
  // tunggu jumpscare selesai dulu
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
    }
    return;
  }
  // client
  switch (d.t) {
    case 'lobby': G.lobby = d.players; G.mode = d.mode; G.mapIdx = d.map; G.ghostChoice = d.ghost; if (G.screen !== 'play' || G.ended) showScreen('lobby'); renderLobby(); break;
    case 'start': startGame(d); break;
    case 'snap': applySnap(d); break;
    case 'pick': applyPick(d.i, d.by); break;
    case 'exit': applyExitOpen(); break;
    case 'esc': onEscaped(d.id); break;
    case 'caught': onCaught(d.id); break;
    case 'end': onEnd(d); break;
    case 'msg': toast(d.text, 2); break;
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
  if (d.g) { ghost.tx = d.g[0]; ghost.tz = d.g[1]; ghost.ry = d.g[2]; ghost.vis = !!d.g[3]; }
  if (d.ex && !G.exitOpen) applyExitOpen();
  W.items.forEach((it, i) => {
    if ((d.it >> i) & 1) { if (!it.taken) { it.taken = true; it.mesh.visible = false; } }
    else if (it.pendingUntil && G.time > it.pendingUntil) { it.pendingUntil = 0; it.mesh.visible = true; } // host menolak
  });
  if (typeof d.vt === 'number') G.vtime = d.vt;
}
function sendSnapshot() {
  const codes = { alive: 0, caught: 1, escaped: 2, ghost: 3 };
  const r2 = (v) => Math.round(v * 100) / 100;
  sendAll({
    t: 'snap', it: G.itemsMask, ex: G.exitOpen ? 1 : 0, vt: Math.round(G.vtime),
    pl: [...G.players.values()].map(p => [p.id, r2(p.x), r2(p.z), r2(p.ry), p.fl ? 1 : 0, codes[p.state] ?? 0, p.hid ? 1 : 0]),
    g: [r2(ghost.x), r2(ghost.z), r2(ghost.ry), ghost.vis ? 1 : 0],
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
        const pl = G.players.get(m.id);
        if (pl && G.screen === 'play') {
          if (pl.mesh) scene.remove(pl.mesh);
          G.players.delete(m.id);
        }
      }
      renderLobby(); broadcastLobby();
      break;
    case 'data': onData(m.from, m.data); break;
    case 'hosts': renderHosts(m.list || [], m.error); break;
    case 'error':
      setMsg(m.msg);
      break;
    case 'closed':
      leaveToMenu(m.msg || 'Koneksi terputus.');
      break;
    case 'fw': setMsg(m.msg); break;
    case 'visible':
      if (!m.v) { keys.clear(); if (document.pointerLockElement) document.exitPointerLock(); if (G.screen === 'play' && G.role === 'solo' && !G.ended) openPause(); }
      break;
  }
}
function setMsg(text) { for (const id of ['menuMsg', 'joinMsg', 'lobbyMsg', 'endMsg']) $(id).textContent = text || ''; }
function broadcastLobby() {
  if (G.role !== 'host') return;
  sendAll({ t: 'lobby', players: G.lobby, mode: G.mode, map: G.mapIdx, ghost: G.ghostChoice });
}

// ======================= EFEK SERAM =======================
function randomScares(dt) {
  const m = me();
  if (!m || m.state !== 'alive' || iAmGhost()) return;
  G.scareTimer -= dt;
  if (G.scareTimer > 0) return;
  G.scareTimer = 22 + Math.random() * 30;
  const kinds = ['whisper', 'knock', 'bang', 'giggle', 'scrape', 'flicker', 'flicker'];
  if (G.mode !== 'versus') kinds.push('apparition', 'apparition');
  const k = kinds[Math.floor(Math.random() * kinds.length)];
  if (k === 'flicker') { W.lamps.forEach(l => l.flickerT = 2 + Math.random()); sfx.randomScare('scrape'); }
  else if (k === 'apparition') showApparition(m);
  else sfx.randomScare(k);
}
// sosok hantu terlihat sekilas di ujung lorong lalu hilang
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

// ======================= JUMPSCARE =======================
const scareCanvas = $('scare'), sctx = scareCanvas.getContext('2d');
function jumpscare() {
  G.scareActive = 1.5;
  scareCanvas.hidden = false;
  scareCanvas.width = 480; scareCanvas.height = 270;
  sfx.scream();
  const fl = $('flash');
  fl.style.transition = 'none'; fl.style.opacity = 0.9;
  requestAnimationFrame(() => { fl.style.transition = 'opacity .5s'; fl.style.opacity = 0; });
}
function drawScare(dt) {
  if (G.scareActive <= 0) return;
  G.scareActive -= dt;
  const t = 1.5 - G.scareActive, w = scareCanvas.width, h = scareCanvas.height, g = sctx;
  if (G.scareActive <= 0) { scareCanvas.hidden = true; return; }
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const scale = 0.7 + Math.min(1, t * 3) * 0.9 + t * 0.15;
  const sx = (Math.random() - 0.5) * 30 * (1.2 - t / 1.5), sy = (Math.random() - 0.5) * 30 * (1.2 - t / 1.5);
  g.save();
  g.translate(w / 2 + sx, h / 2 + sy + 10); g.scale(scale, scale);
  // wajah pucat
  const fg = g.createRadialGradient(0, -10, 10, 0, 0, 130);
  fg.addColorStop(0, '#d8d2c4'); fg.addColorStop(0.7, '#8a8478'); fg.addColorStop(1, '#1a1814');
  g.fillStyle = fg; g.beginPath(); g.ellipse(0, 0, 95 + Math.random() * 3, 125, 0, 0, Math.PI * 2); g.fill();
  // rongga mata
  for (const x of [-38, 38]) {
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, -25, 24 + Math.random() * 2, 30, x < 0 ? 0.2 : -0.2, 0, Math.PI * 2); g.fill();
    const eg = g.createRadialGradient(x, -22, 0, x, -22, 9); eg.addColorStop(0, '#fff'); eg.addColorStop(0.3, '#ff2020'); eg.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = eg; g.beginPath(); g.arc(x + (Math.random() - 0.5) * 3, -22, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(80,0,0,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 4, 4); g.lineTo(x - 7, 40 + Math.random() * 20); g.stroke(); // air mata darah
  }
  // mulut menganga
  const open = 40 + Math.sin(t * 30) * 6;
  g.fillStyle = '#050000'; g.beginPath(); g.ellipse(0, 62, 32, open, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ddd6c0';
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 9 - 4, 62 - open + 4); g.lineTo(i * 9 + 4, 62 - open + 4); g.lineTo(i * 9, 62 - open + 16); g.fill(); }
  // rambut
  // rambut panjang di sisi wajah + beberapa helai di dahi
  g.strokeStyle = '#030303'; g.lineWidth = 6;
  for (let i = 0; i < 14; i++) {
    const side = i < 7 ? -1 : 1, k = i % 7, x = side * (70 + k * 9);
    g.beginPath(); g.moveTo(side * (30 + k * 8), -128); g.quadraticCurveTo(x + (Math.random() - 0.5) * 12, -20, x + side * 10, 160); g.stroke();
  }
  g.lineWidth = 3;
  for (let i = 0; i < 5; i++) { const x = -26 + i * 13; g.beginPath(); g.moveTo(x, -125); g.quadraticCurveTo(x + (Math.random() - 0.5) * 10, -80, x + (Math.random() - 0.5) * 16, -50); g.stroke(); }
  g.restore();
  // garis glitch + merah
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
    if (ghost.vis && gd < 5) lv *= Math.random() < 0.6 ? 0.05 : 0.6; // hantu "memakan" cahaya
    l.level = lv;
    col.copy(base).multiplyScalar(0.25 + lv * 0.9);
    W.lampMesh.setColorAt(i, col);
  });
  W.lampMesh.instanceColor && (W.lampMesh.instanceColor.needsUpdate = true);
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
  // penonton: ikuti pemain lain yang masih bermain
  let viewP = m;
  const spectating = m.state === 'caught' || m.state === 'escaped';
  if (spectating) {
    const others = [...G.players.values()].filter(p => p.state === 'alive');
    if (others.length) viewP = others[G.spectateIdx % others.length];
    $('spectate').hidden = false;
    $('spectate').textContent = others.length ? `Menonton ${viewP.name} · klik untuk ganti` : 'Menunggu permainan selesai…';
  } else $('spectate').hidden = true;
  const ghostView = viewP.state === 'ghost';
  const eye = ghostView ? GHOST_EYE : viewP.hid ? 1.45 : EYE;
  const bob = viewP === m && !m.hid ? Math.sin(m.bob || 0) * (m.sp ? 0.06 : 0.035) : 0;
  camera.position.set(viewP.x, eye + bob, viewP.z);
  camera.rotation.set(viewP === m ? m.pitch : 0, viewP.ry, 0);

  // senter
  const flOn = viewP.fl && viewP.state === 'alive' && !viewP.hid;
  let fi = flOn ? 26 : 0;
  if (flOn && viewP.battery < 0.15 && Math.random() < 0.15) fi *= 0.2;
  flash.intensity = fi;
  // hantu (versus): penglihatan malam kemerahan
  hemi.intensity = ghostView ? 2.2 : W.map.ambient[2];
  hemi.color.set(ghostView ? 0x803030 : W.map.ambient[0]);

  // pemain lain
  let si = 0;
  for (const p of G.players.values()) {
    if (p.id === G.myId) continue;
    if (!isAuth() || p.id !== G.myId) { p.x = lerp(p.x, p.tx, Math.min(1, dt * 12)); p.z = lerp(p.z, p.tz, Math.min(1, dt * 12)); }
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
  ghostMesh.visible = ghost.vis && !(iAmGhost());
  ghostMesh.position.set(ghost.x, 0.05 + Math.sin(ghost.anim * 2.2) * 0.06, ghost.z);
  ghostMesh.rotation.y = ghost.ry;
  ghostMesh.rotation.x = ghost.state === 'chase' ? 0.12 : 0.03;
  ghostMesh.userData.arms.forEach((a, i) => { a.rotation.x = -1.1 + Math.sin(ghost.anim * 3 + i) * 0.15; });

  // item berputar
  W.items.forEach((it, i) => { if (!it.taken) { it.mesh.rotation.y += dt * 1.5; it.mesh.position.y = 0.8 + Math.sin(G.time * 2 + i) * 0.08; } });

  // rasa takut: jarak ke hantu
  let dread = 0;
  if (!ghostView && m.state === 'alive' && ghost.vis) {
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
  if (iAmGhost()) {
    const left = [...G.players.values()].filter(p => p.state === 'alive').length;
    $('obj').innerHTML = `<div class="big">Kamu HANTU</div>Tangkap ${left} pemain tersisa · <b>E</b> periksa lemari<br>${W.map.item.name}: ${n}/${total}${G.exitOpen ? ' · <b style="color:#ff6060">PINTU TERBUKA!</b>' : ''}`;
  } else if (m.state === 'alive') {
    $('obj').innerHTML = G.exitOpen
      ? `<div class="big">Pintu keluar terbuka!</div>Lari ke pintu bertanda KELUAR.`
      : `<div class="big">${W.map.item.name}: ${n}/${total}</div>${W.map.name} · cari dan tekan <b>E</b> untuk mengambil`;
  } else $('obj').innerHTML = m.state === 'escaped' ? '<div class="big">Kamu selamat</div>' : '<div class="big" style="color:#ff5060">Kamu tertangkap</div>';

  $('stam').style.width = (m.stamina * 100) + '%';
  $('bat').style.width = (m.battery * 100) + '%';
  $('hiddenOverlay').hidden = !m.hid;
  if (G.mode === 'versus') { const t = Math.ceil(G.vtime); $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  // ajakan interaksi
  let prompt = '';
  if (m.state === 'alive' && !m.hid) {
    if (nearestItem(m) >= 0) prompt = `<b>E</b> ambil ${W.map.item.name}`;
    else if (nearestLocker(m)) prompt = '<b>E</b> sembunyi di lemari';
  } else if (iAmGhost() && nearestLocker(m, 2.0)) prompt = '<b>E</b> periksa lemari';
  $('prompt').hidden = !prompt; $('prompt').innerHTML = prompt;
  // tim
  if (G.players.size > 1) {
    const ico = { alive: '🟢', caught: '💀', escaped: '🚪', ghost: '👻' };
    $('team').innerHTML = [...G.players.values()].map(p => `${ico[p.state] || ''} ${escapeHtml(p.name)}${p.id === G.myId ? ' (kamu)' : ''}`).join('<br>');
  } else $('team').innerHTML = '';
  $('clickPlay').hidden = locked || G.menuOpen || G.ended || G.screen !== 'play';
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function spectateNext() { const m = me(); if (m && (m.state === 'caught' || m.state === 'escaped')) G.spectateIdx++; }

// ======================= LAYAR / MENU =======================
function showScreen(name) {
  G.screen = name;
  for (const id of ['menu', 'join', 'lobby', 'end']) $(id).hidden = id !== name;
  $('hud').hidden = name !== 'play';
  $('pause').hidden = true;
  G.menuOpen = false;
  if (name !== 'play' && document.pointerLockElement) document.exitPointerLock();
  if (name !== 'play') { sfx.setDread(0); }
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
function renderMenu() {
  document.querySelectorAll('#modes .opt').forEach(o => { o.classList.toggle('sel', o.dataset.mode === settings.mode); o.onclick = () => { settings.mode = o.dataset.mode; store.set('mode', settings.mode); renderMenu(); }; });
  renderMapCards($('maps'), settings.map, (i) => { settings.map = i; store.set('map', i); renderMenu(); });
  const solo = settings.mode === 'solo';
  $('btnSolo').hidden = !solo; $('btnHost').hidden = solo; $('btnJoin').hidden = solo; $('btnFw').hidden = solo;
  if (!hasBridge && !solo) $('menuMsg').textContent = 'Multiplayer hanya tersedia di dalam ZeenIQ Dev Tools.';
}
function renderLobby() {
  const host = G.role === 'host';
  $('lobbyTitle').textContent = host ? 'Room Kamu (Host)' : 'Lobby';
  const ips = (G.hostIps || []).slice(0, 3).map(a => `${a.wifi ? 'Wi-Fi' : a.name} <b>${a.ip}</b>`).join(' · ');
  $('lobbySub').innerHTML = host ? `Bagikan IP ke teman: ${ips || '(tidak ada jaringan)'}` : 'Menunggu host memulai permainan…';
  const pl = $('plist'); pl.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = G.lobby[i];
    const d = document.createElement('div');
    d.className = 'pslot' + (p ? ' on' : '');
    const isGhost = G.mode === 'versus' && p && G.ghostChoice === p.id;
    d.innerHTML = p ? `<div class="nm" style="color:#${COLORS[p.id % 4].toString(16).padStart(6, '0')}">${escapeHtml(p.name)}</div>${p.id === 0 ? 'Host' : 'Pemain'}${p.id === G.myId ? ' · kamu' : ''}${isGhost ? '<div class="ghost">👻 Hantu</div>' : ''}` : 'kosong';
    pl.appendChild(d);
  }
  document.querySelectorAll('#lModes .opt').forEach(o => {
    o.classList.toggle('sel', o.dataset.mode === G.mode);
    o.classList.toggle('dis', !host);
    o.onclick = host ? () => { G.mode = o.dataset.mode; renderLobby(); broadcastLobby(); } : null;
  });
  renderMapCards($('lMaps'), G.mapIdx, (i) => { G.mapIdx = i; renderLobby(); broadcastLobby(); }, host);
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
  const titles = {
    escaped: 'KALIAN SELAMAT', caught: 'TERTANGKAP…', survivors: 'PARA PEMAIN MENANG', ghost: 'HANTU MENANG', ghostleft: 'Hantu keluar dari permainan',
  };
  let title = titles[data.result] || 'Selesai';
  if (G.mode === 'solo') title = data.result === 'escaped' ? 'KAMU SELAMAT' : 'KAMU TERTANGKAP…';
  $('endTitle').textContent = title;
  $('endSub').textContent = `${MAPS[G.mapIdx].name} · ${MODE_NAME[G.mode]} · ${Math.floor(data.time / 60)} menit ${data.time % 60} detik`;
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
  showScreen('menu');
  renderMenu();
  setMsg(msg || '');
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
$('btnSolo').onclick = () => {
  sfx.unlock();
  settings.name = cleanName($('nameIn').value);
  G.role = 'solo'; G.myId = 0;
  startGame(makeStartConfig('solo', settings.map, [{ id: 0, name: settings.name }], -1));
};
$('btnHost').onclick = () => {
  sfx.unlock();
  if (!hasBridge) { setMsg('Multiplayer hanya tersedia di dalam ZeenIQ Dev Tools.'); return; }
  settings.name = cleanName($('nameIn').value);
  G.mode = settings.mode; G.mapIdx = settings.map; G.ghostChoice = -1;
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
  const cfg = makeStartConfig(G.mode, G.mapIdx, G.lobby, G.ghostChoice);
  sendAll(cfg);
  startGame(cfg);
};
$('btnResume').onclick = closePause;
$('btnQuit').onclick = () => {
  if (G.role === 'solo') { G.role = 'none'; showScreen('menu'); renderMenu(); }
  else leaveToMenu('');
};
$('btnAgain').onclick = () => {
  sfx.unlock();
  if (G.role === 'solo') startGame(makeStartConfig('solo', G.mapIdx, [{ id: 0, name: settings.name }], -1));
  else if (G.role === 'host') { showScreen('lobby'); renderLobby(); broadcastLobby(); }
};
$('btnEndMenu').onclick = () => { if (G.role === 'solo') { G.role = 'none'; showScreen('menu'); renderMenu(); } else leaveToMenu(''); };
window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && G.menuOpen && G.screen === 'play') { e.preventDefault(); closePause(); } });

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
    if (!G.paused) {
      updateLocal(dt);
      if (isAuth()) authorityTick(dt); else G.time += dt;
      randomScares(dt);
    }
    updateView(dt);
    updateLamps(dt);
    updateHud(dt);
    drawScare(dt);
    // kirim posisi (15x/detik)
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
  if (G.role === 'host') {
    G.beaconAcc -= dt;
    if (G.beaconAcc <= 0) { G.beaconAcc = 2; bridge({ cmd: 'beacon', name: settings.name, state: G.screen === 'play' && !G.ended ? 'main' : 'lobby', info: `${MODE_NAME[G.mode]} · ${MAPS[G.mapIdx].name} · ${G.lobby.length}/4` }); }
  }
}
// latar menu: lorong gelap pelan-pelan, dirender ringan
let backdropReady = false, bdT = 0;
function menuBackdrop(dt) {
  if (!backdropReady || W.map !== MAPS[0]) {
    backdropReady = true;
    buildWorld(0);
    if (!ghostMesh) { ghostMesh = makeGhostModel(); scene.add(ghostMesh); apparition = makeGhostModel(0x9a948a); apparition.visible = false; scene.add(apparition); }
    G.players.clear();
  }
  bdT += dt;
  camera.position.set(center(12) + Math.sin(bdT * 0.1) * 1.5, EYE, center(10) + Math.cos(bdT * 0.13) * 1.2);
  camera.rotation.set(Math.sin(bdT * 0.2) * 0.05, bdT * 0.05, 0);
  flash.intensity = 0;
  ghost.vis = true; ghost.x = center(12); ghost.z = center(13); ghost.anim += dt;
  ghostMesh.visible = Math.sin(bdT * 0.7) > 0.85;
  ghostMesh.position.set(ghost.x, 0.05, ghost.z);
  updateLamps(dt);
  renderer.render(scene, camera);
}

renderMenu();
bridge({ cmd: 'info' });
requestAnimationFrame(frame);
// dipakai alat uji otomatis
window.__horror = { G, W, ghost, startGame, makeStartConfig, MAPS, settings };
