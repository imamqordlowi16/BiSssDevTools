// Semua suara dibuat dengan Web Audio (sintetis) - tidak ada file audio, jadi tetap ringan.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.8;
    this.scareVolume = 1.0;
    this.heartTimer = 0;
    this.stepPhase = 0;
  }

  // Harus dipanggil dari klik/tombol (aturan browser: audio baru boleh bunyi setelah interaksi).
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this._makeNoise(2);
    this._startAmbient();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noise(dur, { type = 'lowpass', freq = 800, q = 1, gain = 0.3, attack = 0.005, out = this.master, start = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    return { f, g, t };
  }

  _tone(freq, dur, { type = 'sine', gain = 0.2, attack = 0.01, slide = 0, out = this.master, start = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Dengung latar yang tidak pernah berhenti + angin
  _startAmbient() {
    const c = this.ctx;
    this.ambGain = c.createGain();
    this.ambGain.gain.value = 0.12;
    this.ambGain.connect(this.master);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 180;
    lp.connect(this.ambGain);
    for (const f of [41, 43.3, 61.7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = 0.25;
      o.connect(g).connect(lp);
      o.start();
    }
    const wind = c.createBufferSource();
    wind.buffer = this.noiseBuf; wind.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.6;
    const wg = c.createGain(); wg.gain.value = 0.18;
    wind.connect(bp).connect(wg).connect(this.ambGain);
    wind.start();
    // angin naik-turun pelan
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lg = c.createGain(); lg.gain.value = 250;
    lfo.connect(lg).connect(bp.frequency);
    lfo.start();

    // detak/geraman hantu: volume diatur dari game sesuai jarak
    this.dread = c.createGain();
    this.dread.gain.value = 0;
    this.dread.connect(this.master);
    const d1 = c.createOscillator(); d1.type = 'sawtooth'; d1.frequency.value = 55;
    const d2 = c.createOscillator(); d2.type = 'square'; d2.frequency.value = 57.5;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 220;
    const trem = c.createOscillator(); trem.frequency.value = 6;
    const tg = c.createGain(); tg.gain.value = 0.5;
    const dg = c.createGain(); dg.gain.value = 0.5;
    trem.connect(tg).connect(dg.gain);
    d1.connect(dlp); d2.connect(dlp); dlp.connect(dg).connect(this.dread);
    d1.start(); d2.start(); trem.start();
  }

  // 0 = jauh/aman, 1 = hantu tepat di sebelah
  setDread(level) {
    if (!this.dread) return;
    this.dread.gain.setTargetAtTime(Math.min(1, level) * 0.35, this.ctx.currentTime, 0.3);
  }

  // dipanggil tiap frame; bunyi detak jantung makin cepat kalau hantu dekat
  tickHeart(dt, level) {
    if (!this.ctx || level <= 0.05) { this.heartTimer = 0; return; }
    this.heartTimer -= dt;
    if (this.heartTimer <= 0) {
      const bpm = 70 + level * 110;
      this.heartTimer = 60 / bpm;
      const g = 0.25 + level * 0.45;
      this._tone(55, 0.12, { gain: g, slide: -20 });
      this._tone(50, 0.12, { gain: g * 0.7, slide: -18, start: 0.14 });
    }
  }

  step(running, surface = 'wood') {
    const freq = surface === 'wood' ? 380 : surface === 'carpet' ? 220 : 650;
    this._noise(running ? 0.09 : 0.07, { freq, q: 2, gain: running ? 0.22 : 0.12 });
    if (surface === 'wood' && Math.random() < 0.08) this.creak();
  }

  creak() { this._tone(180 + Math.random() * 80, 0.6, { type: 'sawtooth', gain: 0.04, slide: 60, attack: 0.1 }); }

  pickup() {
    this._tone(660, 0.25, { type: 'triangle', gain: 0.18 });
    this._tone(990, 0.4, { type: 'triangle', gain: 0.14, start: 0.08 });
  }

  unlock3() {
    this._noise(0.25, { type: 'highpass', freq: 2500, gain: 0.25 });
    this._tone(220, 0.5, { type: 'square', gain: 0.08, start: 0.1 });
    this._tone(330, 0.8, { type: 'triangle', gain: 0.15, start: 0.25 });
  }

  flashlight() { this._noise(0.03, { type: 'highpass', freq: 3000, gain: 0.25 }); }

  locker() {
    this._noise(0.25, { freq: 500, q: 3, gain: 0.3 });
    this._tone(120, 0.3, { type: 'square', gain: 0.06 });
  }

  // Suara seram acak: bisikan, ketukan, benda jatuh, tawa anak
  randomScare(kind) {
    if (!this.ctx) return;
    switch (kind) {
      case 'whisper':
        for (let i = 0; i < 6; i++) this._noise(0.25 + Math.random() * 0.3, { type: 'bandpass', freq: 1800 + Math.random() * 1500, q: 8, gain: 0.08, start: i * 0.18, attack: 0.08 });
        break;
      case 'knock':
        for (let i = 0; i < 3; i++) this._noise(0.12, { freq: 260, q: 4, gain: 0.6, start: i * 0.35 });
        break;
      case 'bang':
        this._noise(0.8, { freq: 300, gain: 0.7, attack: 0.002 });
        this._tone(60, 0.6, { gain: 0.5, slide: -30 });
        break;
      case 'giggle':
        for (let i = 0; i < 5; i++) this._tone(700 + Math.random() * 200, 0.12, { type: 'triangle', gain: 0.07, start: i * 0.13, slide: 120 });
        break;
      case 'scrape':
        this._noise(1.6, { type: 'bandpass', freq: 900, q: 12, gain: 0.12, attack: 0.4 });
        break;
    }
  }

  // JUMPSCARE: jeritan keras + hantaman bass + derau. Nada berbeda per jenis hantu.
  scream(kind = 'kunti') {
    if (!this.ctx) return;
    const pitch = { kunti: 1, pocong: 0.8, genderuwo: 0.45, anak: 1.45, bayangan: 0.65 }[kind] ?? 1;
    const out = this.ctx.createGain();
    out.gain.value = this.scareVolume;
    out.connect(this.master);
    this._noise(1.4, { type: 'bandpass', freq: 2200 * pitch, q: 0.8, gain: 0.9, attack: 0.003, out });
    this._noise(0.5, { freq: 120, gain: 1.0, attack: 0.002, out });
    for (const [f, type] of [[740, 'sawtooth'], [1110, 'square'], [523, 'sawtooth'], [1480, 'sawtooth']])
      this._tone(f * pitch, 1.3, { type, gain: 0.22, attack: 0.004, slide: -f * pitch * 0.45, out });
    this._tone(45, 0.9, { type: 'sine', gain: 0.9, slide: -15, out });
    if (kind === 'genderuwo') this._tone(70, 1.4, { type: 'sawtooth', gain: 0.6, slide: -30, attack: 0.02, out }); // raungan
    if (kind === 'anak') for (let i = 0; i < 6; i++) this._tone(900 + Math.random() * 300, 0.12, { type: 'triangle', gain: 0.15, start: 0.6 + i * 0.12, slide: 200, out });
    if (kind === 'bayangan') this._noise(1.6, { type: 'lowpass', freq: 300, gain: 0.8, attack: 0.3, out });
  }

  paper() { this._noise(0.35, { type: 'highpass', freq: 3000, q: 0.5, gain: 0.18, attack: 0.02 }); this._noise(0.2, { type: 'highpass', freq: 4000, gain: 0.12, start: 0.25 }); }

  search() {
    this._noise(0.3, { freq: 700, q: 2, gain: 0.25 });
    this._noise(0.25, { freq: 1200, q: 3, gain: 0.15, start: 0.3 });
    this._tone(300, 0.15, { type: 'square', gain: 0.03, start: 0.15 });
  }

  battery() { this._tone(880, 0.1, { type: 'square', gain: 0.08 }); this._tone(1320, 0.18, { type: 'square', gain: 0.08, start: 0.1 }); }

  // ---- Suara hantu terarah: vol 0..1 (jarak), pan -1 kiri .. 1 kanan, muffled = terhalang dinding ----
  _spatial(vol, pan, muffled) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = vol;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    let node = g;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
    if (muffled) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 450; node.connect(lp); node = lp; }
    node.connect(this.master);
    return g;
  }

  ghostStep(type, vol, pan, muffled) {
    if (!this.ctx || vol < 0.02) return;
    const out = this._spatial(vol, pan, muffled);
    switch (type) {
      case 'genderuwo': // dentuman berat
        this._tone(42, 0.4, { gain: 0.9, slide: -15, out });
        this._noise(0.15, { freq: 160, gain: 0.6, out });
        break;
      case 'pocong': // "dug" mendarat setelah melompat
        this._noise(0.12, { freq: 320, q: 2, gain: 0.7, out });
        this._tone(85, 0.15, { gain: 0.45, slide: -30, out });
        break;
      case 'anak': // langkah kecil cepat
        this._noise(0.05, { freq: 900, q: 3, gain: 0.35, out });
        break;
      case 'bayangan': // desis menyeret
        this._noise(0.4, { type: 'bandpass', freq: 2500, q: 4, gain: 0.18, attack: 0.15, out });
        break;
      default: // kuntilanak: kaki diseret di lantai
        this._noise(0.35, { type: 'bandpass', freq: 700, q: 3, gain: 0.3, attack: 0.08, out });
    }
  }

  ghostVoice(type, vol, pan, muffled, chasing) {
    if (!this.ctx || vol < 0.03) return;
    const out = this._spatial(vol, pan, muffled);
    const R = Math.random;
    switch (type) {
      case 'genderuwo': // geraman + napas berat
        this._tone(68 + R() * 10, 1.2, { type: 'sawtooth', gain: 0.35, attack: 0.15, slide: chasing ? 30 : -15, out });
        this._noise(0.9, { freq: 260, q: 1, gain: 0.35, attack: 0.3, out, start: 0.2 });
        break;
      case 'pocong': // erangan tertahan
        this._tone(140 + R() * 30, 1.6, { type: 'triangle', gain: 0.25, attack: 0.4, slide: -50, out });
        this._noise(1.2, { type: 'bandpass', freq: 500, q: 5, gain: 0.12, attack: 0.5, out });
        break;
      case 'anak': // tawa / senandung anak
        if (chasing || R() < 0.6) for (let i = 0; i < 6; i++) this._tone(750 + R() * 250, 0.12, { type: 'triangle', gain: 0.22, start: i * 0.13, slide: 150, out });
        else [523, 587, 523, 440].forEach((f, i) => this._tone(f, 0.45, { type: 'sine', gain: 0.14, start: i * 0.5, attack: 0.08, out }));
        break;
      case 'bayangan': // bisikan
        for (let i = 0; i < 7; i++) this._noise(0.22 + R() * 0.3, { type: 'bandpass', freq: 1800 + R() * 1800, q: 9, gain: 0.25, start: i * 0.16, attack: 0.07, out });
        break;
      default: // kuntilanak: tawa melengking atau rintihan panjang
        if (chasing || R() < 0.5) for (let i = 0; i < 7; i++) this._tone(1100 + R() * 300 - i * 40, 0.16, { type: 'sawtooth', gain: 0.12, start: i * 0.14, slide: 250, out });
        else this._tone(620 + R() * 80, 2.2, { type: 'sine', gain: 0.18, attack: 0.5, slide: -260, out });
    }
  }

  // langkah berat genderuwo / lompatan pocong - volume sesuai jarak (0..1)
  stomp(level) { if (level > 0.02) { this._tone(48, 0.35, { gain: 0.6 * level, slide: -18 }); this._noise(0.12, { freq: 180, gain: 0.35 * level }); } }
  hop(level) { if (level > 0.02) { this._noise(0.1, { freq: 400, q: 2, gain: 0.4 * level }); this._tone(90, 0.12, { gain: 0.3 * level, slide: -30 }); } }

  intro() { // dentang pembuka
    this._tone(65, 4, { type: 'sine', gain: 0.5, attack: 0.05, slide: -10 });
    this._tone(98, 3.5, { type: 'triangle', gain: 0.12, attack: 0.05 });
    this._noise(3, { type: 'bandpass', freq: 600, q: 6, gain: 0.08, attack: 1 });
  }

  stinger() { // nada kejut kecil (hantu terlihat sekilas)
    this._tone(1200, 0.5, { type: 'sawtooth', gain: 0.12, slide: -700, attack: 0.003 });
    this._noise(0.4, { type: 'highpass', freq: 2000, gain: 0.15 });
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.5, { type: 'triangle', gain: 0.15, start: i * 0.15 }));
  }
}
