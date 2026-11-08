// Werewolf clip library (assets/clips/ww_clips.json, built from Werewolf_Anim_Set_FBX_Only_v1.2).
// Each frame stores, per source bone, the WORLD-space rotation delta from the source rest pose
// (int16 quaternions), followed by 7 floats: hips xyz offset and toe/ankle heights (in leg lengths).

export interface ClipInfo {
    id: string;
    frames: number;
    fps: number;
    loop: boolean;
    ground: "lock" | "air";
    root: "none" | "drift" | "feet";
    offset: number;
    natural?: [number, number];
    steps?: [number, number][];
}

export interface ClipHeader {
    fps: number;
    bones: string[];
    hipsRest: number;
    restPos: Record<string, [number, number, number]>;
    hinge: Record<string, [number, number, number]>;
    clips: ClipInfo[];
}

/** A sampled pose: per-bone delta quaternions (x,y,z,w) + 7 extras. */
export class Pose {
    readonly q: Float32Array;
    readonly ex = new Float32Array(7);
    constructor(readonly bones: number) {
        this.q = new Float32Array(bones * 4);
        this.identity();
    }
    identity(): this {
        this.q.fill(0);
        for (let i = 0; i < this.bones; i++) this.q[i * 4 + 3] = 1;
        this.ex.fill(0);
        return this;
    }
    copyFrom(p: Pose): this {
        this.q.set(p.q);
        this.ex.set(p.ex);
        return this;
    }
}

const INV = 1 / 32767;

export class Clip {
    readonly id: string;
    readonly duration: number;
    constructor(
        readonly info: ClipInfo,
        private readonly q: Int16Array,
        private readonly ex: Float32Array,
        private readonly nb: number,
    ) {
        this.id = info.id;
        this.duration = (info.loop ? info.frames : Math.max(1, info.frames - 1)) / info.fps;
    }
    get frames(): number {
        return this.info.frames;
    }
    /** Natural forward/side speed of the clip in leg lengths per second (x = left, z = forward). */
    get natural(): number {
        const n = this.info.natural;
        return n ? Math.hypot(n[0], n[1]) : 0;
    }
    /** Sample at frame position f (fractional). */
    sampleFrame(f: number, out: Pose): Pose {
        const n = this.info.frames;
        let a: number, b: number, t: number;
        if (this.info.loop) {
            f = ((f % n) + n) % n;
            a = Math.floor(f);
            b = (a + 1) % n;
            t = f - a;
        } else {
            f = Math.max(0, Math.min(n - 1, f));
            a = Math.floor(f);
            b = Math.min(n - 1, a + 1);
            t = f - a;
        }
        const nb = this.nb, q = this.q, o = out.q;
        const ia = a * nb * 4, ib = b * nb * 4;
        for (let i = 0; i < nb * 4; i += 4) {
            const ax = q[ia + i] * INV, ay = q[ia + i + 1] * INV, az = q[ia + i + 2] * INV, aw = q[ia + i + 3] * INV;
            let bx = q[ib + i] * INV, by = q[ib + i + 1] * INV, bz = q[ib + i + 2] * INV, bw = q[ib + i + 3] * INV;
            if (ax * bx + ay * by + az * bz + aw * bw < 0) {
                bx = -bx; by = -by; bz = -bz; bw = -bw;
            }
            const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, w = aw + (bw - aw) * t;
            const l = Math.hypot(x, y, z, w) || 1;
            o[i] = x / l; o[i + 1] = y / l; o[i + 2] = z / l; o[i + 3] = w / l;
        }
        const ea = a * 7, eb = b * 7;
        for (let k = 0; k < 7; k++) out.ex[k] = this.ex[ea + k] + (this.ex[eb + k] - this.ex[ea + k]) * t;
        return out;
    }
    sample(time: number, out: Pose): Pose {
        return this.sampleFrame(time * this.info.fps, out);
    }
    /** Lowest foot height (leg lengths) at frame f, from the stored toe/ankle heights. */
    static lowFoot(p: Pose): number {
        return Math.min(p.ex[3], p.ex[4], p.ex[5], p.ex[6]);
    }
}

/** Weighted pose accumulator (normalised quaternion average with sign alignment). */
export class PoseMixer {
    private readonly acc: Float32Array;
    private readonly ex = new Float32Array(7);
    private w = 0;
    constructor(readonly bones: number) {
        this.acc = new Float32Array(bones * 4);
    }
    clear(): void {
        this.acc.fill(0);
        this.ex.fill(0);
        this.w = 0;
    }
    get weight(): number {
        return this.w;
    }
    add(p: Pose, w: number): void {
        if (w <= 1e-5) return;
        const a = this.acc, q = p.q;
        for (let i = 0; i < a.length; i += 4) {
            const s = a[i] * q[i] + a[i + 1] * q[i + 1] + a[i + 2] * q[i + 2] + a[i + 3] * q[i + 3] < 0 ? -w : w;
            a[i] += q[i] * s; a[i + 1] += q[i + 1] * s; a[i + 2] += q[i + 2] * s; a[i + 3] += q[i + 3] * s;
        }
        for (let k = 0; k < 7; k++) this.ex[k] += p.ex[k] * w;
        this.w += w;
    }
    finish(out: Pose): Pose {
        if (this.w <= 1e-6) return out.identity();
        const a = this.acc;
        for (let i = 0; i < a.length; i += 4) {
            const l = Math.hypot(a[i], a[i + 1], a[i + 2], a[i + 3]);
            if (l < 1e-6) {
                out.q[i] = out.q[i + 1] = out.q[i + 2] = 0;
                out.q[i + 3] = 1;
            } else {
                out.q[i] = a[i] / l; out.q[i + 1] = a[i + 1] / l; out.q[i + 2] = a[i + 2] / l; out.q[i + 3] = a[i + 3] / l;
            }
        }
        for (let k = 0; k < 7; k++) out.ex[k] = this.ex[k] / this.w;
        return out;
    }
}

/** Blend b into a (in place) by weight t. */
export function blendPose(a: Pose, b: Pose, t: number): void {
    if (t <= 0) return;
    if (t >= 1) {
        a.copyFrom(b);
        return;
    }
    const x = a.q, y = b.q;
    for (let i = 0; i < x.length; i += 4) {
        const s = x[i] * y[i] + x[i + 1] * y[i + 1] + x[i + 2] * y[i + 2] + x[i + 3] * y[i + 3] < 0 ? -1 : 1;
        const qx = x[i] + (y[i] * s - x[i]) * t, qy = x[i + 1] + (y[i + 1] * s - x[i + 1]) * t;
        const qz = x[i + 2] + (y[i + 2] * s - x[i + 2]) * t, qw = x[i + 3] + (y[i + 3] * s - x[i + 3]) * t;
        const l = Math.hypot(qx, qy, qz, qw) || 1;
        x[i] = qx / l; x[i + 1] = qy / l; x[i + 2] = qz / l; x[i + 3] = qw / l;
    }
    for (let k = 0; k < 7; k++) a.ex[k] += (b.ex[k] - a.ex[k]) * t;
}

export class ClipLibrary {
    readonly clips = new Map<string, Clip>();
    readonly boneIndex = new Map<string, number>();
    constructor(readonly header: ClipHeader, data: Uint8Array) {
        header.bones.forEach((b, i) => this.boneIndex.set(b, i));
        const nb = header.bones.length;
        const buf = new ArrayBuffer(data.byteLength);
        new Uint8Array(buf).set(data);
        for (const c of header.clips) {
            const n = c.frames * nb * 4;
            this.clips.set(c.id, new Clip(c, new Int16Array(buf, c.offset, n), new Float32Array(buf, c.offset + n * 2, c.frames * 7), nb));
        }
    }
    get bones(): number {
        return this.header.bones.length;
    }
    get(id: string): Clip {
        const c = this.clips.get(id);
        if (!c) throw new Error(`clip ${id} missing`);
        return c;
    }
    newPose(): Pose {
        return new Pose(this.bones);
    }

    private static pending: Promise<ClipLibrary> | null = null;
    static load(url: string): Promise<ClipLibrary> {
        if (!this.pending) {
            this.pending = fetch(url)
                .then((r) => {
                    if (!r.ok) throw new Error(`clips HTTP ${r.status}`);
                    return r.json();
                })
                .then((j: ClipHeader & { data: string }) => {
                    const bin = atob(j.data);
                    const u8 = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                    return new ClipLibrary(j, u8);
                });
        }
        return this.pending;
    }
}
