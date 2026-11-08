import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Actor } from "./actor";
import { CLAW } from "./config";

export interface BotWorld {
    actors: Actor[];
    path(from: Vector3, to: Vector3): Vector3[];
    randomPoint(near: Vector3, radius: number): Vector3;
    los(a: Vector3, b: Vector3): boolean;
    enemySpawn(team: number): Vector3;
    time: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Simple combat AI: target selection with line of sight, navmesh paths, gun or claw tactics, transforms. */
export class BotBrain {
    target: Actor | null = null;
    private seen = false;
    private lastSeen = new Vector3();
    private lastSeenT = -99;
    private scanT = 0;
    private path: Vector3[] = [];
    private pathT = 0;
    private goal = new Vector3();
    private hasGoal = false;
    private strafe = 1;
    private strafeT = 0;
    private burstT = 0;
    private pauseT = 0;
    private reactT = 0;
    private aimErr = 0.1;
    private yaw = 0;
    private pitch = 0;
    private stuckT = 0;
    private stuckPos = new Vector3();
    private jumpT = 0;
    private noTargetT = 0;
    private readonly tv = new Vector3();
    private readonly tv2 = new Vector3();
    /** 0..1 */
    skill: number;
    /** how much this bot likes wolf form (0.3..1.3) */
    wolfy: number;

    constructor(readonly me: Actor, readonly w: BotWorld) {
        this.skill = 0.35 + Math.random() * 0.4;
        this.wolfy = 0.3 + Math.random();
        this.yaw = me.yaw;
    }

    reset(): void {
        this.target = null;
        this.path = [];
        this.hasGoal = false;
        this.yaw = this.me.yaw;
        this.pitch = 0;
        this.noTargetT = 0;
    }

    update(dt: number): void {
        const me = this.me, it = me.intent, w = this.w;
        it.fire = it.jump = it.transform = it.reload = it.lunge = it.walk = false;
        it.moveX = it.moveZ = 0;
        if (!me.alive) return;
        // ---- perception
        this.scanT -= dt;
        if (this.scanT <= 0) {
            this.scanT = 0.22 + Math.random() * 0.1;
            this.scan();
        }
        const t = this.target;
        const eye = me.eye(this.tv);
        let dist = Infinity;
        if (t) {
            dist = Vector3.Distance(me.pos, t.pos);
            if (this.seen) {
                this.lastSeen.copyFrom(t.pos);
                this.lastSeenT = w.time;
            }
        }
        if (t && this.seen) this.noTargetT = 0;
        else this.noTargetT += dt;

        // ---- shape decisions
        if (!me.transforming && me.transformCd <= 0) {
            if (me.form === "human") {
                const close = t && this.seen && dist < 6.5;
                const roam = !t && this.noTargetT > 6 && Math.random() < dt * 0.05;
                const losing = t && me.hp < 40 && dist < 9 && Math.random() < dt * 0.5;
                if ((close && Math.random() < dt * this.wolfy) || roam || losing) it.transform = true;
            } else {
                const far = t && this.seen && dist > 13 && Math.random() < dt * 0.7 * (1.5 - this.wolfy);
                const idle = !t && this.noTargetT > 5 && Math.random() < dt * 0.12;
                if (far || idle) it.transform = true;
            }
        }

        // ---- movement goal
        let moveTo: Vector3 | null = null;
        if (t && this.seen) {
            if (me.form === "wolf") moveTo = t.pos;
            else if (dist > 22) moveTo = t.pos;
        } else if (t && w.time - this.lastSeenT < 6) {
            moveTo = this.lastSeen;
        } else {
            if (!this.hasGoal || Vector3.DistanceSquared(me.pos, this.goal) < 2.5) {
                const toward = Math.random() < 0.6 ? w.enemySpawn(me.team) : me.pos;
                this.goal.copyFrom(w.randomPoint(toward, 12));
                this.hasGoal = true;
                this.pathT = 0;
            }
            moveTo = this.goal;
        }
        const desired = this.tv2.setAll(0);
        if (moveTo) {
            this.pathT -= dt;
            if (this.pathT <= 0 || this.path.length === 0) {
                this.path = w.path(me.navPos, moveTo);
                this.pathT = 0.6 + Math.random() * 0.3;
            }
            while (this.path.length > 1 && Math.hypot(this.path[0].x - me.pos.x, this.path[0].z - me.pos.z) < 0.6) this.path.shift();
            const wp = this.path[0] ?? moveTo;
            desired.set(wp.x - me.pos.x, 0, wp.z - me.pos.z);
            const dl = desired.length();
            if (dl > 0.05) desired.scaleInPlace(1 / dl);
        }
        // human combat footwork
        if (t && this.seen && me.form === "human") {
            this.strafeT -= dt;
            if (this.strafeT <= 0) {
                this.strafe = Math.random() < 0.5 ? -1 : 1;
                this.strafeT = 0.6 + Math.random() * 1.1;
            }
            const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
            const rx = -cy, rz = sy;
            desired.x += rx * this.strafe * 0.8;
            desired.z += rz * this.strafe * 0.8;
            if (dist < (t.form === "wolf" ? 9 : 5)) {
                desired.x -= sy;
                desired.z -= cy;
            }
        }

        // ---- aim
        let wantYaw = this.yaw, wantPitch = 0;
        if (t && this.seen) {
            const c = t.chest(new Vector3());
            if (me.form === "human" && Math.random() < 0.2 * this.skill) c.y += t.form === "wolf" ? 0.4 : 0.38;
            const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
            wantYaw = Math.atan2(dx, dz);
            wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
            this.reactT += dt;
        } else {
            this.reactT = 0;
            if (desired.lengthSquared() > 0.01) wantYaw = Math.atan2(desired.x, desired.z);
        }
        const turn = (me.form === "wolf" ? 9 : 5.5) * (0.7 + this.skill * 0.6) * dt;
        const dyaw = wrap(wantYaw - this.yaw);
        this.yaw += Math.max(-turn, Math.min(turn, dyaw));
        this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 6);
        // jitter that shrinks while tracking
        this.aimErr += ((t && this.seen ? 0.012 + (1 - this.skill) * 0.05 / (1 + this.reactT) : 0.1) - this.aimErr) * Math.min(1, dt * 3);
        it.yaw = this.yaw + Math.sin(w.time * 2.3 + me.id) * this.aimErr;
        it.pitch = this.pitch + Math.cos(w.time * 1.9 + me.id * 3) * this.aimErr * 0.6;

        // ---- convert desired world move to local intent
        const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
        it.moveZ = desired.x * sy + desired.z * cy;
        it.moveX = -desired.x * cy + desired.z * sy;

        // ---- attack
        const aligned = Math.abs(dyaw) < 0.12 + 0.6 / Math.max(1, dist);
        if (t && this.seen) {
            if (me.form === "human") {
                if (me.ammo === 0) it.reload = true;
                this.burstT -= dt;
                this.pauseT -= dt;
                if (this.reactT > 0.45 - this.skill * 0.2 && aligned && dist < 45) {
                    if (this.pauseT <= 0) {
                        it.fire = true;
                        if (this.burstT <= 0) this.burstT = 0.35 + Math.random() * 0.5;
                    }
                    if (this.burstT > 0 && this.burstT - dt <= 0) this.pauseT = 0.15 + Math.random() * 0.35;
                }
            } else {
                if (dist < CLAW.range * 0.95 && Math.abs(dyaw) < 0.6) it.fire = true;
                else if (dist > 3.5 && dist < 7.5 && aligned && me.lungeCd <= 0 && Math.random() < dt * 2.5) it.lunge = true;
                if (t.pos.y - me.pos.y > 1.2 && dist < 6 && Math.random() < dt * 2) it.jump = true;
            }
        } else if (me.form === "human" && me.ammo < 12 && me.reserve > 0) it.reload = true;

        // ---- unstick
        this.jumpT -= dt;
        this.stuckT += dt;
        if (this.stuckT > 1.4) {
            const moved = Vector3.Distance(this.stuckPos, me.pos);
            if (moved < 0.4 && desired.lengthSquared() > 0.2) {
                this.hasGoal = false;
                this.path = [];
                if (this.jumpT <= 0) {
                    it.jump = true;
                    this.jumpT = 2;
                }
            }
            this.stuckPos.copyFrom(me.pos);
            this.stuckT = 0;
        }
    }

    private scan(): void {
        const me = this.me, w = this.w;
        const eye = me.eye(new Vector3());
        let best: Actor | null = null, bestD = Infinity, bestSeen = false;
        const cand = w.actors.filter((a) => a.alive && a.team !== me.team).map((a) => ({ a, d: Vector3.Distance(a.pos, me.pos) })).sort((x, y) => x.d - y.d).slice(0, 3);
        const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
        for (const { a, d } of cand) {
            if (d > 55) continue;
            // field of view (wide) unless very close or it just hurt us
            const dx = (a.pos.x - me.pos.x) / Math.max(0.01, d), dz = (a.pos.z - me.pos.z) / Math.max(0.01, d);
            const inFov = dx * fx + dz * fz > -0.2 || d < 6 || me.lastHitBy === a.id;
            if (!inFov) continue;
            const vis = w.los(eye, a.chest(new Vector3()));
            const score = d * (vis ? 1 : 3) * (a === this.target ? 0.8 : 1);
            if (score < bestD) {
                bestD = score;
                best = a;
                bestSeen = vis;
            }
        }
        if (best && (bestSeen || best === this.target)) {
            this.target = best;
            this.seen = bestSeen;
        } else {
            this.seen = false;
            if (this.target && (!this.target.alive || w.time - this.lastSeenT > 6)) this.target = null;
        }
        if (this.target && !this.target.alive) {
            this.target = null;
            this.seen = false;
        }
    }
}
