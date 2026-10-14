import type { AgentId } from "./types";

// All sounds are synthesized with the Web Audio API — tiny square/triangle/sine
// blips like an 8-bit console, so there are no audio files to load.

type Wave = OscillatorType;

interface Tone {
  at: number; // start offset (s)
  dur: number; // seconds
  freq: number;
  to?: number; // glide target frequency
  wave?: Wave;
  gain?: number;
}

interface Noise {
  at: number;
  dur: number;
  gain?: number;
  highpass?: number;
}

interface Cue {
  tones: Tone[];
  noise?: Noise[];
}

export type CueName =
  | `${AgentId}_start`
  | `${AgentId}_end`
  | "pickup"
  | "kaching"
  | "approve_purchase"
  | "deny"
  | "error"
  | "fanfare"
  | "reminder";

const seq = (notes: number[], step: number, wave: Wave, dur = step * 0.9, gain = 0.22): Tone[] =>
  notes.map((freq, i) => ({ at: i * step, dur, freq, wave, gain }));

const CUES: Record<CueName, Cue> = {
  // Boss: command beep / victory chirp
  boss_start: { tones: [{ at: 0, dur: 0.07, freq: 988, wave: "square" }, { at: 0.1, dur: 0.07, freq: 988, wave: "square" }] },
  boss_end: { tones: seq([1047, 1319, 1568, 2093], 0.06, "square") },

  // Inventory: scanner blip / item-collected jingle
  inventory_start: {
    tones: [
      { at: 0, dur: 0.05, freq: 1400, to: 2600, wave: "sine", gain: 0.25 },
      { at: 0.08, dur: 0.05, freq: 1400, to: 2600, wave: "sine", gain: 0.25 },
    ],
  },
  inventory_end: { tones: seq([784, 1047, 1319], 0.07, "triangle", 0.09, 0.3) },

  // Accounting: calculator ticks / ledger-complete chime
  accounting_start: {
    tones: [0, 0.06, 0.12].map((at) => ({ at, dur: 0.018, freq: 3200, wave: "square" as Wave, gain: 0.12 })),
  },
  accounting_end: {
    tones: [
      { at: 0, dur: 0.45, freq: 1319, wave: "sine", gain: 0.22 },
      { at: 0.08, dur: 0.5, freq: 1760, wave: "sine", gain: 0.18 },
    ],
  },

  // Facilities: mechanical click / power-up tone
  facilities_start: {
    tones: [{ at: 0, dur: 0.035, freq: 140, wave: "square", gain: 0.2 }],
    noise: [{ at: 0, dur: 0.03, gain: 0.25, highpass: 1500 }],
  },
  facilities_end: { tones: [{ at: 0, dur: 0.32, freq: 220, to: 880, wave: "square", gain: 0.16 }] },

  // Customer Service: message bloop / cheerful reply melody
  customer_service_start: { tones: [{ at: 0, dur: 0.09, freq: 700, to: 320, wave: "sine", gain: 0.3 }] },
  customer_service_end: { tones: seq([659, 784, 880, 784, 1047], 0.075, "triangle", 0.07, 0.28) },

  // Ticket pickup: two-note "insert coin"
  pickup: { tones: seq([523, 784], 0.08, "square") },

  // Cash register: drawer rattle + two bright bells
  kaching: {
    tones: [
      { at: 0.05, dur: 0.5, freq: 2093, wave: "sine", gain: 0.25 },
      { at: 0.12, dur: 0.6, freq: 2637, wave: "sine", gain: 0.22 },
    ],
    noise: [{ at: 0, dur: 0.07, gain: 0.3, highpass: 2500 }],
  },

  approve_purchase: { tones: [{ at: 0, dur: 0.12, freq: 660, to: 990, wave: "triangle", gain: 0.28 }] },
  deny: { tones: seq([330, 220], 0.1, "square", 0.09, 0.18) },
  error: { tones: [{ at: 0, dur: 0.28, freq: 110, wave: "square", gain: 0.2 }] },
  fanfare: { tones: seq([523, 659, 784, 1047, 784, 1047], 0.1, "square", 0.09, 0.2) },
  // Reminder: alarm-clock double ring, repeated
  reminder: { tones: seq([1568, 1175, 1568, 1175, 1568, 1175], 0.09, "square", 0.07, 0.2) },
};

const MIN_GAP_MS = 160; // never start two cues closer than this
const SAME_CUE_COOLDOWN_MS = 400; // the same cue can't repeat back-to-back
const MAX_QUEUE = 4; // drop extra cues rather than build up a backlog

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private queue: CueName[] = [];
  private timer: number | null = null;
  private lastPlayed = new Map<CueName, number>();
  private muted = false;
  private volume = 0.6;

  /** Must be called from a user gesture — browsers block audio until then. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyGain();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.queue = [];
    this.applyGain();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyGain();
  }

  play(name: CueName): void {
    if (!this.ctx || this.muted || this.volume === 0) return;
    const last = this.lastPlayed.get(name) ?? 0;
    if (performance.now() - last < SAME_CUE_COOLDOWN_MS) return;
    if (this.queue.includes(name) || this.queue.length >= MAX_QUEUE) return;
    this.queue.push(name);
    this.pump();
  }

  private applyGain(): void {
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  private pump(): void {
    if (this.timer !== null) return;
    const next = this.queue.shift();
    if (!next) return;
    const seconds = this.render(CUES[next]);
    this.lastPlayed.set(next, performance.now());
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(MIN_GAP_MS, seconds * 1000 * 0.6));
  }

  private render(cue: Cue): number {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.01;
    let end = 0;

    for (const tone of cue.tones) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = tone.wave ?? "square";
      osc.frequency.setValueAtTime(tone.freq, t0 + tone.at);
      if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t0 + tone.at + tone.dur);
      const peak = tone.gain ?? 0.22;
      env.gain.setValueAtTime(0.0001, t0 + tone.at);
      env.gain.exponentialRampToValueAtTime(peak, t0 + tone.at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.at + tone.dur);
      osc.connect(env).connect(this.master!);
      osc.start(t0 + tone.at);
      osc.stop(t0 + tone.at + tone.dur + 0.02);
      end = Math.max(end, tone.at + tone.dur);
    }

    for (const n of cue.noise ?? []) {
      const src = ctx.createBufferSource();
      src.buffer = this.getNoise();
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = n.highpass ?? 1000;
      const env = ctx.createGain();
      env.gain.setValueAtTime(n.gain ?? 0.2, t0 + n.at);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      src.connect(filter).connect(env).connect(this.master!);
      src.start(t0 + n.at);
      src.stop(t0 + n.at + n.dur + 0.02);
      end = Math.max(end, n.at + n.dur);
    }
    return end;
  }

  private getNoise(): AudioBuffer {
    if (!this.noiseBuffer) {
      const ctx = this.ctx!;
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }
}

export const sound = new SoundEngine();
