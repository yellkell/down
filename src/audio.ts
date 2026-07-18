/**
 * Audio: the original DOWN soundtrack + stingers, played via HTMLAudio
 * (reliable inside WebXR sessions on Quest browser, no unlock quirks
 * beyond the first user gesture, which the BEGIN button provides).
 */
const SFX = {
  begin: '/audio/begin.ogg',
  awesome: '/audio/awesome.ogg',
  excellent: '/audio/excellent.ogg',
  die: '/audio/die.ogg',
  gameover: '/audio/gameover.ogg',
  square: '/audio/square.ogg'
} as const;

export type SfxName = keyof typeof SFX;

const TRACKS = [
  '/audio/digital-paradisio.mp3',
  '/audio/island-circuits.mp3',
  '/audio/island-pixelio.mp3',
  '/audio/island-pixels.mp3'
];

class AudioManager {
  private sfx = new Map<SfxName, HTMLAudioElement>();
  private tracks: HTMLAudioElement[] = [];
  private current = 0;
  private musicOn = false;

  init(): void {
    (Object.keys(SFX) as SfxName[]).forEach((name) => {
      const el = new Audio(SFX[name]);
      el.preload = 'auto';
      this.sfx.set(name, el);
    });
    this.tracks = TRACKS.map((url) => {
      const el = new Audio(url);
      el.preload = 'none';
      el.volume = 0.55;
      el.addEventListener('ended', () => this.next());
      return el;
    });
  }

  play(name: SfxName, volume = 1): void {
    const el = this.sfx.get(name);
    if (!el) return;
    el.currentTime = 0;
    el.volume = volume;
    void el.play().catch(() => {});
  }

  startMusic(): void {
    this.musicOn = true;
    this.current = 0;
    const track = this.tracks[0];
    track.currentTime = 0;
    void track.play().catch(() => {});
  }

  stopMusic(): void {
    this.musicOn = false;
    this.tracks.forEach((t) => t.pause());
  }

  private next(): void {
    if (!this.musicOn) return;
    this.current = (this.current + 1) % this.tracks.length;
    const track = this.tracks[this.current];
    track.currentTime = 0;
    void track.play().catch(() => {});
  }
}

export const audio = new AudioManager();
