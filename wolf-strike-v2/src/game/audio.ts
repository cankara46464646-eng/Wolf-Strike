import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Small WebAudio mixer: SFX with distance/pan, music, announcer queue. Plays the supplied files unchanged. */
export class Audio {
    readonly ctx: AudioContext;
    private master: GainNode;
    private sfx: GainNode;
    private musicBus: GainNode;
    private voice: GainNode;
    private buffers = new Map<string, Promise<AudioBuffer | null>>();
    private listener = { x: 0, y: 0, z: 0, yaw: 0 };
    private musicSrc: AudioBufferSourceNode | null = null;
    private musicPath = "";
    private voiceBusyUntil = 0;
    private voicePrio = 99;
    private noise: AudioBuffer;
    private lastPlay = new Map<string, number>();

    constructor(private base: string) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.sfx = this.bus(0.9);
        this.musicBus = this.bus(0.35);
        this.voice = this.bus(1);
        const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
        const d = n.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noise = n;
        const unlock = () => {
            if (this.ctx.state !== "running") void this.ctx.resume();
        };
        for (const ev of ["pointerdown", "touchend", "keydown"]) window.addEventListener(ev, unlock, { capture: true });
    }

    private bus(v: number): GainNode {
        const g = this.ctx.createGain();
        g.gain.value = v;
        g.connect(this.master);
        return g;
    }

    setVolumes(master: number, music: number): void {
        this.master.gain.value = master;
        this.musicBus.gain.value = 0.35 * music;
    }

    load(path: string): Promise<AudioBuffer | null> {
        let p = this.buffers.get(path);
        if (!p) {
            const url = this.base + "audio/" + path.split("/").map(encodeURIComponent).join("/");
            p = fetch(url)
                .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
                .then((b) => this.ctx.decodeAudioData(b))
                .catch((e) => {
                    console.warn("[audio] missing", path, e);
                    return null;
                });
            this.buffers.set(path, p);
        }
        return p;
    }

    preload(paths: string[]): Promise<unknown> {
        return Promise.all(paths.map((p) => this.load(p)));
    }

    setListener(pos: Vector3, yaw: number): void {
        this.listener.x = pos.x;
        this.listener.y = pos.y;
        this.listener.z = pos.z;
        this.listener.yaw = yaw;
    }

    private spatial(pos: Vector3 | undefined, range: number): { gain: number; pan: number } {
        if (!pos) return { gain: 1, pan: 0 };
        const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
        const d = Math.hypot(dx, dy, dz);
        const gain = 1 / (1 + Math.max(0, d - 2) / (range * 0.25));
        // right vector of a listener facing (sin yaw, cos yaw) in a right-handed, Y-up world: (-cos, 0, sin)
        const rx = -Math.cos(this.listener.yaw), rz = Math.sin(this.listener.yaw);
        const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
        return { gain: d > range ? 0 : gain, pan };
    }

    play(path: string, opts: { vol?: number; rate?: number; pos?: Vector3; range?: number; minGap?: number } = {}): void {
        if (this.ctx.state !== "running") return;
        const now = this.ctx.currentTime;
        if (opts.minGap) {
            const last = this.lastPlay.get(path) ?? -1;
            if (now - last < opts.minGap) return;
            this.lastPlay.set(path, now);
        }
        const { gain, pan } = this.spatial(opts.pos, opts.range ?? 45);
        if (gain <= 0.01) return;
        void this.load(path).then((buf) => {
            if (!buf) return;
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.playbackRate.value = opts.rate ?? 1;
            const g = this.ctx.createGain();
            g.gain.value = (opts.vol ?? 1) * gain;
            const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
            if (p) {
                p.pan.value = pan;
                src.connect(g).connect(p).connect(this.sfx);
            } else src.connect(g).connect(this.sfx);
            src.start();
        });
    }

    /** Synthesised claw swipe (no file supplied for it). */
    whoosh(pos?: Vector3, vol = 0.5): void {
        if (this.ctx.state !== "running") return;
        const { gain, pan } = this.spatial(pos, 30);
        if (gain <= 0.01) return;
        const t = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        const f = this.ctx.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 1.4;
        f.frequency.setValueAtTime(500, t);
        f.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
        f.frequency.exponentialRampToValueAtTime(700, t + 0.24);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol * gain, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        const p = this.ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(f).connect(g).connect(p).connect(this.sfx);
        src.start(t);
        src.stop(t + 0.3);
    }

    /** Synthesised hit-confirm tick for the local player. */
    tick(head = false): void {
        if (this.ctx.state !== "running") return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(head ? 1800 : 1250, t);
        o.frequency.exponentialRampToValueAtTime(head ? 1300 : 900, t + 0.05);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        o.connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + 0.08);
    }

    music(path: string | null): void {
        if (path === this.musicPath) return;
        this.musicPath = path ?? "";
        if (this.musicSrc) {
            const old = this.musicSrc;
            try {
                old.stop(this.ctx.currentTime + 0.4);
            } catch {
                /* already stopped */
            }
            this.musicSrc = null;
        }
        if (!path) return;
        void this.load(path).then((buf) => {
            if (!buf || this.musicPath !== path) return;
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.connect(this.musicBus);
            src.start();
            this.musicSrc = src;
        });
    }

    /** Announcer line; a lower priority number wins while another line is playing. */
    announce(file: string, prio: number): void {
        const now = this.ctx.currentTime;
        if (now < this.voiceBusyUntil && prio >= this.voicePrio) return;
        void this.load("announcer/" + file).then((buf) => {
            if (!buf) return;
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.connect(this.voice);
            src.start();
            this.voiceBusyUntil = this.ctx.currentTime + buf.duration;
            this.voicePrio = prio;
        });
    }
}
