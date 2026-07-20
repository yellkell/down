/**
 * Audio, played via HTMLAudio (reliable inside WebXR sessions on Quest
 * browser; the BEGIN button click provides the unlock gesture).
 *
 * Soundtrack: "Run" on loop. Voice lines reward each slide you survive.
 * All paths are relative so the game works from a subpath (GitHub Pages).
 */
const SFX = {
  begin: './audio/begin.ogg',
  die: './audio/die.ogg',
  gameover: './audio/gameover.ogg',
  square: './audio/square.ogg',
  nice: './audio/nice.wav',
  perfect: './audio/perfect.wav',
  welldone: './audio/welldone.wav'
} as const;

export type SfxName = keyof typeof SFX;

class AudioManager {
  private sfx = new Map<SfxName, HTMLAudioElement>();
  private music: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;

  init(): void {
    (Object.keys(SFX) as SfxName[]).forEach((name) => {
      const el = new Audio(SFX[name]);
      el.preload = 'auto';
      this.sfx.set(name, el);
    });
    // AAC where supported, Vorbis everywhere else (open-codec Chromium
    // builds ship without AAC — no browser should ever lose the music).
    const probe = document.createElement('audio');
    const src = probe.canPlayType('audio/mp4; codecs="mp4a.40.2"')
      ? './audio/run.m4a'
      : './audio/run.ogg';
    this.music = new Audio(src);
    this.music.preload = 'auto';
    this.music.loop = true;
    this.music.volume = 0.6;
  }

  play(name: SfxName, volume = 1): void {
    const el = this.sfx.get(name);
    if (!el) return;
    el.currentTime = 0;
    el.volume = volume;
    void el.play().catch(() => {});
  }

  /**
   * Tiny synthesized UI blip for keyboard feedback — the .ogg files are
   * voice lines and countdown stingers, all wrong for a key press. Lazily
   * creates the AudioContext (first call always follows a user gesture).
   */
  blip(freq: number, dur = 0.05, vol = 0.18): void {
    try {
      this.ctx ??= new AudioContext();
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch {
      /* feedback audio is never worth crashing over */
    }
  }

  startMusic(): void {
    if (!this.music) return;
    this.music.currentTime = 0;
    void this.music.play().catch(() => {});
  }

  /** Playhead of the soundtrack in seconds, or null if it isn't running —
   * the game syncs its phase transitions to this clock. */
  musicTime(): number | null {
    if (!this.music || this.music.paused) return null;
    return this.music.currentTime;
  }

  stopMusic(): void {
    this.music?.pause();
  }

  /** Silence the previous run before replaying its opening cue. */
  stopAll(): void {
    this.music?.pause();
    this.sfx.forEach((el) => {
      el.pause();
      el.currentTime = 0;
    });
  }
}

export const audio = new AudioManager();
