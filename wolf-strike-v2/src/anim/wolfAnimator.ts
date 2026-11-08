import { Clip, ClipLibrary, Pose, PoseMixer, blendPose } from "./clips";
import type { Retarget } from "./retarget";

const WALK = ["walk_f", "walk_fr", "walk_r", "walk_br", "walk_b", "walk_bl", "walk_l", "walk_fl"];
const RUN = ["run_f", "run_fr", "run_r", "run_br", "run_b", "run_bl", "run_l", "run_fl"];

export interface ActionSpec {
    clip: string;
    from?: number;
    to?: number;
    rate?: number;
    weight?: number;
    fadeIn?: number;
    fadeOut?: number;
    contact?: number; // frame that fires onContact
    hold?: boolean; // stay on the last frame (death)
    air?: boolean; // physics owns the height while it plays
}

/** Attack timings (frames of the source clips). */
export const WOLF_ATTACKS = {
    claw_left: { clip: "swipe_l", contact: 11, from: 7, to: 30, rate: 1.25 },
    claw_right: { clip: "swipe_r", contact: 15, from: 10, to: 33, rate: 1.3 },
    claw_finisher: { clip: "power_double", contact: 11, from: 5, to: 21, rate: 1.2 },
    lunge: { clip: "power", contact: 21, from: 14, to: 30, rate: 1.15 },
    claw_air: { clip: "jump_swipe", contact: 31, from: 21, to: 38, rate: 1.2, air: true },
} satisfies Record<string, ActionSpec>;

interface Playing {
    spec: ActionSpec;
    clip: Clip;
    frame: number;
    from: number;
    to: number;
    rate: number;
    w: number; // current fade weight
    out: boolean; // fading out
    fired: boolean;
    onContact?: () => void;
    done?: () => void;
}

/**
 * Wolf locomotion + actions on the retargeted werewolf clips: 8-way walk/run blending with
 * phase sync, sprint, jump (start/loop/land), one-shot attacks with contact events, hits, howl, death.
 */
export class WolfAnimator {
    private readonly mixer: PoseMixer;
    private readonly tmp: Pose;
    private readonly base: Pose;
    private readonly act: Pose;
    private readonly walk: Clip[];
    private readonly run: Clip[];
    private readonly idle: Clip;
    private readonly sprint: Clip;
    private readonly jStart: Clip;
    private readonly jLoop: Clip;
    private phase = 0;
    private idleT = 0;
    private wIdle = 1;
    private wWalk = 0;
    private wRun = 0;
    private wSprint = 0;
    private dirA = 0; // smoothed direction index (0..8)
    private airT = 0; // time since leaving the ground
    private air = 0; // air blend weight
    private jumpT = -1;
    private actions: Playing[] = [];
    rate = 1; // per-wolf profile rate

    constructor(readonly lib: ClipLibrary, readonly rt: Retarget, readonly legLenWorld: number) {
        this.mixer = new PoseMixer(lib.bones);
        this.tmp = lib.newPose();
        this.base = lib.newPose();
        this.act = lib.newPose();
        this.walk = WALK.map((c) => lib.get(c));
        this.run = RUN.map((c) => lib.get(c));
        this.idle = lib.get("idle");
        this.sprint = lib.get("sprint_short");
        this.jStart = lib.get("jump_start");
        this.jLoop = lib.get("jump_loop");
    }

    get busy(): boolean {
        return this.actions.some((a) => !a.out && !a.spec.hold);
    }

    play(spec: ActionSpec, onContact?: () => void, done?: () => void): void {
        // fade out whatever is playing
        for (const a of this.actions) a.out = true;
        const clip = this.lib.get(spec.clip);
        const from = spec.from ?? 0;
        const to = spec.to ?? clip.frames - 1;
        this.actions.push({ spec, clip, frame: from, from, to, rate: (spec.rate ?? 1) * this.rate, w: 0, out: false, fired: false, onContact, done });
    }

    stopActions(): void {
        for (const a of this.actions) a.out = true;
    }

    /** Jump was triggered by physics. */
    jump(): void {
        this.jumpT = 0;
        this.airT = 1;
    }

    land(hard: boolean): void {
        this.jumpT = -1;
        if (!this.busy) this.play({ clip: "jump_end", from: hard ? 6 : 9, to: 24, rate: 1.15, fadeIn: 0.04, fadeOut: 0.2, weight: hard ? 1 : 0.75 });
    }

    /**
     * fwd/right: local velocity in m/s (model space). grounded from physics.
     */
    update(dt: number, fwd: number, right: number, grounded: boolean): void {
        const L = this.legLenWorld;
        const spd = Math.hypot(fwd, right) / L; // leg lengths per second
        // --- direction (8-way, smoothed around the circle)
        if (spd > 0.05) {
            let a = Math.atan2(right, fwd) / (Math.PI / 4);
            a = (a + 8) % 8;
            let d = a - this.dirA;
            if (d > 4) d -= 8;
            if (d < -4) d += 8;
            this.dirA = (this.dirA + d * Math.min(1, dt * 12) + 8) % 8;
        }
        const i0 = Math.floor(this.dirA) % 8, i1 = (i0 + 1) % 8, t = this.dirA - Math.floor(this.dirA);
        // --- gait weights
        const k = Math.min(1, dt / 0.2);
        const forwardish = Math.abs(Math.atan2(right, fwd)) < 0.5;
        const tIdle = spd < 0.25 ? 1 : 0;
        const runMix = Math.max(0, Math.min(1, (spd - 1.3) / 1.3));
        const sprintMix = forwardish ? Math.max(0, Math.min(1, (spd - 5.6) / 1.0)) : 0;
        const tMove = 1 - tIdle;
        const tSprint = tMove * sprintMix;
        const tRun = tMove * runMix * (1 - sprintMix);
        const tWalk = tMove * (1 - runMix) * (1 - sprintMix);
        this.wIdle += (tIdle - this.wIdle) * k;
        this.wWalk += (tWalk - this.wWalk) * k;
        this.wRun += (tRun - this.wRun) * k;
        this.wSprint += (tSprint - this.wSprint) * k;
        // --- rates and shared phase
        const nat = (c: Clip[]) => c[i0].natural * (1 - t) + c[i1].natural * t || 1;
        const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
        const walkRate = clamp(spd / nat(this.walk), 0.75, 1.45);
        const runRate = clamp(spd / nat(this.run), 0.72, 1.3);
        const sprintRate = clamp(spd / (this.sprint.natural || 7), 0.8, 1.35);
        const wm = this.wWalk + this.wRun + this.wSprint;
        if (wm > 1e-3) {
            const dp = (this.wWalk * walkRate / this.walk[0].duration + this.wRun * runRate / this.run[0].duration + this.wSprint * sprintRate / this.sprint.duration) / wm;
            this.phase = (this.phase + dt * dp * this.rate) % 1;
        }
        this.idleT += dt * this.rate;
        // --- air
        if (grounded) this.airT = 0;
        else this.airT += dt;
        const inAir = !grounded && (this.airT > 0.18 || this.jumpT >= 0);
        this.air += ((inAir ? 1 : 0) - this.air) * Math.min(1, dt / 0.12);
        // --- build the base pose
        const m = this.mixer, p = this.tmp;
        m.clear();
        if (this.wIdle > 1e-3) m.add(this.idle.sample(this.idleT % this.idle.duration, p), this.wIdle);
        if (this.wWalk > 1e-3) {
            m.add(this.walk[i0].sampleFrame(this.phase * this.walk[i0].frames, p), this.wWalk * (1 - t));
            m.add(this.walk[i1].sampleFrame(this.phase * this.walk[i1].frames, p), this.wWalk * t);
        }
        if (this.wRun > 1e-3) {
            m.add(this.run[i0].sampleFrame(this.phase * this.run[i0].frames, p), this.wRun * (1 - t));
            m.add(this.run[i1].sampleFrame(this.phase * this.run[i1].frames, p), this.wRun * t);
        }
        if (this.wSprint > 1e-3) m.add(this.sprint.sampleFrame(this.phase * this.sprint.frames, p), this.wSprint);
        m.finish(this.base);
        let lowFoot = Clip.lowFoot(this.base);
        if (this.air > 1e-3) {
            if (this.jumpT >= 0) this.jumpT += dt;
            // jump_start 18 -> 30 at 1.25x, then the loop
            const sf = 18 + (this.jumpT >= 0 ? this.jumpT * 30 * 1.25 : 99);
            if (sf < 30) this.jStart.sampleFrame(sf, p);
            else this.jLoop.sample(((sf - 30) / 30) % this.jLoop.duration, p);
            blendPose(this.base, p, this.air);
            lowFoot *= 1 - this.air;
        }
        // --- actions
        let airAct = 0;
        for (const a of this.actions) {
            const fi = a.spec.fadeIn ?? 0.07, fo = a.spec.fadeOut ?? 0.18;
            if (!a.out) {
                a.w = Math.min(1, a.w + dt / Math.max(1e-3, fi));
                a.frame += dt * a.clip.info.fps * a.rate;
                if (!a.fired && a.spec.contact !== undefined && a.frame >= a.spec.contact) {
                    a.fired = true;
                    a.onContact?.();
                }
                if (a.frame >= a.to) {
                    a.frame = a.to;
                    if (!a.spec.hold) {
                        a.out = true;
                        a.done?.();
                        a.done = undefined;
                    }
                }
            } else {
                a.w -= dt / Math.max(1e-3, fo);
            }
        }
        this.actions = this.actions.filter((a) => a.w > 0 || (!a.out && a.w === 0));
        for (const a of this.actions) {
            const w = Math.max(0, Math.min(1, a.w)) * (a.spec.weight ?? 1);
            if (w <= 1e-3) continue;
            a.clip.sampleFrame(a.frame, this.act);
            const isAir = a.spec.air || a.clip.info.ground === "air";
            const lf = isAir ? 0 : Clip.lowFoot(this.act);
            blendPose(this.base, this.act, w);
            lowFoot += (lf - lowFoot) * w;
            if (isAir) airAct = Math.max(airAct, w);
        }
        void airAct;
        // horizontal hips drift from big root-motion clips is kept (it is within the body footprint)
        this.rt.apply(this.base, lowFoot);
    }
}

export async function loadWolfClips(base: string): Promise<ClipLibrary> {
    return ClipLibrary.load(`${base}clips/ww_clips.json`);
}
