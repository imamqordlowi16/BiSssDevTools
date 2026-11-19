// Peta game horor. 1 karakter = 1 sel 2x2 meter.
//
//   #  dinding           .  lantai          D  kusen pintu (bisa dilewati)
//   S  titik mulai pemain  G  titik mulai hantu   X  pintu keluar (terkunci sampai semua item terkumpul)
//   K  calon lokasi item   L  lampu langit-langit
//   B  ranjang   T  meja   C  lemari/rak   (padat, menghalangi jalan)
//   H  lemari/loker tempat sembunyi (tekan E di depannya)
//   c  kursi (hiasan, bisa dilewati)
//
// Semua peta dicek otomatis (tools/check-maps.mjs): baris sama panjang, tepi tertutup,
// semua item/loker/pintu keluar bisa dijangkau dari titik mulai.

export const MAPS = [
  {
    id: 'rumah',
    name: 'Rumah Tua',
    desc: 'Rumah peninggalan keluarga yang hilang tanpa jejak. Lantai kayu berderit di setiap langkah.',
    item: { name: 'Kunci Tua', kind: 'oldkey' },
    exitText: 'Pintu depan terkunci. Temukan kunci-kunci tua untuk membukanya.',
    intro: {
      place: 'Rumah keluarga Wiratmaja', time: 'Jumat, 23:47',
      lines: ['Sudah dua puluh tahun rumah ini kosong.', 'Kamu datang mencari tahu ke mana keluarga itu menghilang.', 'Begitu masuk, pintu depan terkunci dari dalam.'],
    },
    notes: [
      'Malam ketiga. Suara itu kembali dari kamar belakang. Bapak bilang itu cuma tikus.',
      'Jangan nyalakan lampu. Dia tertarik pada cahaya. Aku mendengarnya berjalan di lorong.',
      'Aku bersembunyi di dalam lemari selama dua jam. Dia berdiri tepat di depan pintunya.',
      'Kalau kamu membaca ini, keluarlah lewat pintu depan. Jangan pernah kembali.',
    ],
    fog: 0x07050a, fogDensity: 0.085, ambient: [0x4a3c50, 0x0a0806, 0.6],
    wall: 'wallpaper', floor: 'wood', ceiling: 0x1a1410,
    palette: { wall: '#3b2a2a', wall2: '#2a1d1d', floor: '#3a2716', floor2: '#2a1b0f', prop: 0x3b2a1e, prop2: 0x6b5a48, metal: 0x4a4038 },
    lamp: 0xffb070, ghost: { wander: 1.5, chase: 3.4 },
    grid: [
      '##########################',
      '#S..c..#..........#...C..#',
      '#..T...#...L......#..K...#',
      '#......D..........D......#',
      '#..L...#....T.T...#..L..H#',
      '###D####..........####D###',
      '#......#....c.....#......#',
      '#..B...######D#####..B...#',
      '#..B..H#..........#K.....#',
      '#......D....L.....D...L..#',
      '#..L...#..........#......#',
      '#K.....#####..#####..C...#',
      '###D####..........####D###',
      '#......D....G.....D......#',
      '#..T.L.#..........#..L.T.#',
      '#..c...#..C....C..#...c..#',
      '#K....H#....L.....#H....K#',
      '#......#..........#......#',
      '######X###################',
    ],
  },
  {
    id: 'rs',
    name: 'Rumah Sakit',
    desc: 'Bangsal yang ditutup sejak kebakaran tahun 1987. Lampu darurat masih berkedip.',
    item: { name: 'Kartu Akses', kind: 'card' },
    exitText: 'Pintu darurat butuh kartu akses. Kumpulkan semua kartu dari bangsal.',
    intro: {
      place: 'RS Santa Mirah, bangsal yang ditutup', time: 'Senin, 02:13',
      lines: ['Bangsal ini ditutup sejak kebakaran tahun 1987.', 'Tapi lampu daruratnya masih menyala setiap malam.', 'Pintu di belakangmu tertutup sendiri. Pintu darurat butuh kartu akses.'],
    },
    notes: [
      'Laporan jaga malam: pasien kamar 4 hilang dari ranjangnya. Pintu terkunci dari dalam.',
      'Suster Ratna bilang ada yang memanggil namanya dari ruang mayat. Dia tidak kembali.',
      'Jangan berlari di lorong. Dia mendengar langkah kaki.',
      'Kartu akses disembunyikan di bangsal supaya tidak ada yang keluar. Termasuk kita.',
    ],
    fog: 0x050a08, fogDensity: 0.075, ambient: [0x3a5046, 0x050806, 0.6],
    wall: 'tiles', floor: 'checker', ceiling: 0x18201c,
    palette: { wall: '#5d6e64', wall2: '#45524a', floor: '#3c4440', floor2: '#2c3230', prop: 0xb8c0bc, prop2: 0x6e7a76, metal: 0x8a9490 },
    lamp: 0xc8ffe6, ghost: { wander: 1.6, chase: 3.6 },
    grid: [
      '############################',
      '#S...#.B.B.B.#.B.B.B.#....K#',
      '#....#.......#.......#.....#',
      '#.L..#...L...#...L...#..L..#',
      '#....#K.....H#......H#.....#',
      '##D#####D#########D#####D###',
      '#..........................#',
      '#.L.....L.....G.....L.....L#',
      '#..........................#',
      '##D#####D#########D#####D###',
      '#....#C.....C#T....T#C....H#',
      '#.L..#...L...#...L..#...L..#',
      '#....#......K#..c...#......#',
      '#H...#.B...B.#T....T#..B..K#',
      '#K...#.B...B.#......#..B...#',
      '#########X##################',
    ],
  },
  {
    id: 'sekolah',
    name: 'Sekolah',
    desc: 'Malam Jumat di sekolah lama. Katanya ada murid yang tidak pernah pulang.',
    item: { name: 'Kunci Kelas', kind: 'key' },
    exitText: 'Gerbang sekolah digembok. Cari kunci-kunci kelas yang tercecer.',
    intro: {
      place: 'SMP Cempaka Putih (gedung lama)', time: 'Kamis malam, 23:59',
      lines: ['Kalian taruhan menginap semalam di sekolah lama.', 'Penjaga sekolah berpesan: jangan masuk kelas paling ujung.', 'Tepat tengah malam, lonceng berbunyi sendiri. Gerbang sudah digembok.'],
    },
    notes: [
      'Daftar hadir kelas 9-C: satu nama dicoret dengan tinta merah. Tanggalnya 13 tahun lalu.',
      'Siapa yang menulis di papan tulis? Tulisannya sama terus: PULANG.',
      'Kunci-kunci kelas disebar penjaga sebelum dia kabur. Gerbang tidak akan terbuka tanpa itu.',
      'Kalau mendengar tawa anak-anak, jangan menoleh. Jalan terus.',
    ],
    fog: 0x06060a, fogDensity: 0.07, ambient: [0x404858, 0x0a0a08, 0.6],
    wall: 'school', floor: 'lino', ceiling: 0x1c1c1e,
    palette: { wall: '#7a7058', wall2: '#2f4a3a', floor: '#3e3a32', floor2: '#34302a', prop: 0x6b4a2c, prop2: 0x2a3a2e, metal: 0x5a5e62 },
    lamp: 0xf0f4ff, ghost: { wander: 1.6, chase: 3.7 },
    grid: [
      '##############################',
      '#S.......#T.T.T.T#T.T.T.T#..K#',
      '#...L....#.......#.......#...#',
      '#........#T.T.T.T#T.T.T.T#.L.#',
      '#..C..C..#...L...#...L...#...#',
      '#........#T.T.T.T#T.T.T.T#..H#',
      '#K......H#......K#.......#...#',
      '####D#########D#######D###D###',
      '#............................#',
      '#..L......L.......L......L...#',
      '#............G...............#',
      '####D#########D####D######D###',
      '#..C.C..#T.T.T.T#.....#......#',
      '#.......#.......#..L..#..L...#',
      '#..L....#T.T.T.T#.....#.T.T..#',
      '#H.....K#...L..H#K..C.#......#',
      '#########################X####',
    ],
  },
  {
    id: 'kantor',
    name: 'Kantor Malam Hari',
    desc: 'Lembur sendirian di lantai 13. Listrik padam, dan kamu tidak benar-benar sendirian.',
    item: { name: 'Sekring', kind: 'fuse' },
    exitText: 'Lift mati. Pasang sekring-sekring yang hilang untuk menyalakannya.',
    intro: {
      place: 'Menara Sentosa, lantai 13', time: 'Rabu, 21:30',
      lines: ['Lembur lagi. Semua orang sudah pulang.', 'Listrik padam tiba-tiba dan lift ikut mati.', 'Di ujung lorong ada yang mengetik di komputer. Padahal kamu sendirian.'],
    },
    notes: [
      'Memo HRD: karyawan dilarang lembur lewat jam 9 malam. Tidak ada penjelasan.',
      'Rekaman CCTV lantai 13 selalu rusak di menit yang sama: 21:47.',
      'Sekring panel lift sengaja dilepas teknisi supaya "itu" tidak bisa turun. Katanya.',
      'Kalau monitor menyala sendiri, jangan baca tulisannya.',
    ],
    fog: 0x04060a, fogDensity: 0.07, ambient: [0x384460, 0x06070a, 0.6],
    wall: 'panel', floor: 'carpet', ceiling: 0x16181c,
    palette: { wall: '#4a5260', wall2: '#3a404c', floor: '#2a3040', floor2: '#232838', prop: 0x5a6070, prop2: 0x8a8e96, metal: 0x6a707c },
    lamp: 0xdde8ff, ghost: { wander: 1.7, chase: 3.8 },
    grid: [
      '############################',
      '#S.....#....C.C....#......K#',
      '#..L...#...........#...L...#',
      '#......D...T...T...D.......#',
      '#T..T..#.K.........#..T.T..#',
      '#......#...L...L...#......H#',
      '###D####...........####D####',
      '#..........T...T...........#',
      '#.L..T.T.......G.....T.T.L.#',
      '#....T.T...T...T.....T.T...#',
      '#............K.............#',
      '###D####..H..L..C..####D####',
      '#K.....#...........#.......#',
      '#..T...#..T.T.T.T..#..L....#',
      '#..L..HD...........D....T.K#',
      '#......#....L......#H......#',
      '############X###############',
    ],
  },
];

export const SOLID = new Set(['#', 'B', 'T', 'C', 'H']);
export const BLOCKS_SIGHT = new Set(['#', 'C', 'H']);

// Dipakai game & alat cek: semua sel yang bisa diinjak dari titik mulai.
export function reachable(grid, open = true) {
  const h = grid.length, w = grid[0].length;
  const start = [];
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) if (grid[z][x] === 'S') start.push([x, z]);
  const seen = new Set(start.map(([x, z]) => z * w + x));
  const q = [...start];
  while (q.length) {
    const [x, z] = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      const ch = grid[nz][nx];
      if (SOLID.has(ch) || (ch === 'X' && !open)) continue;
      const k = nz * w + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nx, nz]);
    }
  }
  return seen;
}
