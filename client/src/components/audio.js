/**
 * Аудио менеджері: эпикалық музыка + SFX.
 * Браузердің autoplay саясатын ескереді (алғашқы әрекеттен кейін қосылады).
 */
const FILES = {
  theme: 'theme',
  battle: 'battle',
  sword: 'sword',
  correct: 'correct',
  wrong: 'wrong',
  door: 'door',
  victory: 'victory',
  gameover: 'gameover',
  heartLost: 'heart-lost',
  click: 'click',
};

class AudioManager {
  constructor() {
    this.enabled = localStorage.getItem('kzrpg_muted') !== '1';
    this.sounds = {};
    this.currentMusic = null;
    this.unlocked = false;
    this._preload();
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
      window.addEventListener(ev, () => this._unlock(), { once: true });
    });
  }

  _preload() {
    Object.entries(FILES).forEach(([key, name]) => {
      const a = new Audio(`assets/audio/${name}.ogg`);
      a.preload = 'auto';
      if (key === 'theme' || key === 'battle') {
        a.loop = true;
        a.volume = 0.34;
      } else {
        a.volume = 0.55;
      }
      this.sounds[key] = a;
    });
  }

  _unlock() {
    this.unlocked = true;
    if (this.pendingMusic) {
      const key = this.pendingMusic;
      this.pendingMusic = null;
      this.playMusic(key);
    }
  }

  play(key) {
    if (!this.enabled) return;
    const src = this.sounds[key];
    if (!src) return;
    try {
      const node = src.cloneNode();
      node.volume = src.volume;
      node.play().catch(() => {});
    } catch (_) { /* дыбыс қолжетімсіз */ }
  }

  playMusic(key) {
    if (!this.enabled) { this.pendingMusic = key; return; }
    if (!this.unlocked) { this.pendingMusic = key; return; }
    if (this.currentMusic === key) return;
    this.stopMusic();
    const track = this.sounds[key];
    if (!track) return;
    this.currentMusic = key;
    track.currentTime = 0;
    track.play().catch(() => { this.pendingMusic = key; });
    this._fadeIn(track, 0.34);
  }

  stopMusic() {
    if (!this.currentMusic) return;
    const track = this.sounds[this.currentMusic];
    this.currentMusic = null;
    if (!track) return;
    this._fadeOut(track);
  }

  _fadeIn(track, target, ms = 900) {
    const step = target / (ms / 50);
    track.volume = 0;
    const id = setInterval(() => {
      track.volume = Math.min(target, track.volume + step);
      if (track.volume >= target - 0.001) clearInterval(id);
    }, 50);
  }

  _fadeOut(track, ms = 600) {
    const start = track.volume;
    const step = start / (ms / 50);
    const id = setInterval(() => {
      track.volume = Math.max(0, track.volume - step);
      if (track.volume <= 0.001) {
        clearInterval(id);
        track.pause();
        track.currentTime = 0;
        track.volume = start;
      }
    }, 50);
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('kzrpg_muted', this.enabled ? '0' : '1');
    if (!this.enabled) {
      Object.values(this.sounds).forEach((s) => { s.pause(); });
      this.currentMusic = null;
    }
    return this.enabled;
  }
}

export const audio = new AudioManager();
export default audio;
