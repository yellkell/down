/**
 * Audio. Two transports, deliberately:
 *
 * - SFX/voice lines: WebAudio buffers. HTMLAudio elements proved flaky for
 *   one-shots inside Quest's XR sessions — playback silently paused or
 *   never started depending on element state and activation timing. A
 *   decoded AudioBuffer fired through the context (the same context the
 *   keyboard blips already use successfully in-headset) has no element
 *   state machine to wedge: once the context is running, start() plays.
 * - Music: HTMLAudio, because it streams a 4MB file and its currentTime
 *   is the sync clock the whole game runs on.
 *
 * The context unlocks on the 2D intro button click (a real DOM gesture);
 * everything after that — including UIKit clicks in VR, which are NOT DOM
 * gestures — just works. All paths are relative so the game works from a
 * subpath (GitHub Pages).
 */
const SFX = {
  begin: './audio/begin.ogg',
  one: './audio/countdown-one.ogg',
  two: './audio/countdown-two.ogg',
  three: './audio/countdown-three.ogg',
  lookdown: './audio/look-down.ogg',
  die: './audio/die.ogg',
  gameover: './audio/gameover.ogg',
  nice: './audio/nice.wav',
  perfect: './audio/perfect.wav',
  welldone: './audio/welldone.wav'
} as const;

export type SfxName = keyof typeof SFX;

export type MusicId =
  | 'original'
  | 'chase'
  | 'sakupened'
  | 'fusion'
  | 'give-it-to-me';

export interface MusicTrack {
  id: MusicId;
  label: string;
  src: string;
  /** Only the original soundtrack has authored slide-drop timestamps. */
  synchronized: boolean;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: 'original', label: 'ORIGINAL', src: './audio/run.m4a', synchronized: true },
  { id: 'chase', label: 'CHASE', src: './audio/chase.mp3', synchronized: false },
  { id: 'sakupened', label: 'SAKUPENED', src: './audio/sakupened.mp3', synchronized: false },
  {
    id: 'fusion',
    label: 'FUTURE VIBE',
    src: './audio/fusion.mp3',
    synchronized: false
  },
  {
    id: 'give-it-to-me',
    label: 'GIVE IT TO ME',
    src: './audio/give-it-to-me.mp3',
    synchronized: false
  }
] as const;

export function isMusicId(value: string | null): value is MusicId {
  return MUSIC_TRACKS.some((track) => track.id === value);
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private live = new Set<AudioBufferSourceNode>();
  private music: HTMLAudioElement | null = null;
  private musicId: MusicId = 'original';
  private canPlayAac = false;

  init(): void {
    this.ctx ??= new AudioContext();
    (Object.keys(SFX) as SfxName[]).forEach((name) => {
      void fetch(SFX[name])
        .then((res) => res.arrayBuffer())
        .then((buf) => this.ctx!.decodeAudioData(buf))
        .then((decoded) => this.buffers.set(name, decoded))
        .catch(() => {}); // a missing stinger is never fatal
    });

    // AAC where supported, Vorbis everywhere else (open-codec Chromium
    // builds ship without AAC — no browser should ever lose the music).
    const probe = document.createElement('audio');
    this.canPlayAac = Boolean(probe.canPlayType('audio/mp4; codecs="mp4a.40.2"'));
    this.selectMusic(this.musicId);
  }

  /** Replace the streamed soundtrack while preserving the one shared player. */
  selectMusic(id: MusicId): void {
    const track = MUSIC_TRACKS.find((candidate) => candidate.id === id);
    if (!track) return;
    this.music?.pause();
    this.musicId = id;
    const src = id === 'original' && !this.canPlayAac ? './audio/run.ogg' : track.src;
    this.music = new Audio(src);
    this.music.preload = 'auto';
    this.music.loop = true;
    this.music.volume = this.baseMusicVolume();
  }

  /** Sakupened and Future Vibe were supplied as hotter MP3 masters. The original
   * track and the two M4A-sourced bonus tracks keep the full music level. */
  private baseMusicVolume(): number {
    return this.musicId === 'sakupened' || this.musicId === 'fusion' ? 0.38 : 0.6;
  }

  /** Call from any real DOM gesture (the intro button) so the context is
   * running before VR, where UIKit clicks don't count as gestures. */
  unlock(): void {
    void this.ctx?.resume().catch(() => {});
  }

  play(name: SfxName, volume = 1): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !buffer) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    this.live.add(source);
    source.onended = () => this.live.delete(source);
    source.start();
  }

  /**
   * Tiny synthesized UI blip for keyboard feedback — the .ogg files are
   * voice lines and countdown stingers, all wrong for a key press.
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
    const track = MUSIC_TRACKS.find((candidate) => candidate.id === this.musicId);
    if (!track?.synchronized || !this.music || this.music.paused) return null;
    return this.music.currentTime;
  }

  stopMusic(): void {
    this.music?.pause();
  }

  /** Silence the previous run before replaying its opening cue. */
  stopAll(): void {
    this.music?.pause();
    this.live.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    });
    this.live.clear();
  }
}

export const audio = new AudioManager();
