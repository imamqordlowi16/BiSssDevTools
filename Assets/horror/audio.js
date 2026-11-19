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

  // JUMPSCARE: jeritan keras + hantaman bass + derau
  scream() {
    if (!this.ctx) return;
    const out = this.ctx.createGain();
    out.gain.value = this.scareVolume;
    out.connect(this.master);
    this._noise(1.4, { type: 'bandpass', freq: 2200, q: 0.8, gain: 0.9, attack: 0.003, out });
    this._noise(0.5, { freq: 120, gain: 1.0, attack: 0.002, out });
    for (const [f, type] of [[740, 'sawtooth'], [1110, 'square'], [523, 'sawtooth'], [1480, 'sawtooth']])
      this._tone(f, 1.3, { type, gain: 0.22, attack: 0.004, slide: -f * 0.45, out });
    this._tone(45, 0.9, { type: 'sine', gain: 0.9, slide: -15, out });
  }

  stinger() { // nada kejut kecil (hantu terlihat sekilas)
    this._tone(1200, 0.5, { type: 'sawtooth', gain: 0.12, slide: -700, attack: 0.003 });
    this._noise(0.4, { type: 'highpass', freq: 2000, gain: 0.15 });
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.5, { type: 'triangle', gain: 0.15, start: i * 0.15 }));
  }
}
