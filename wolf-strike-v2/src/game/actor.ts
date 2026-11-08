import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ModelInstance } from "./models";
import type { HumanAnimator } from "../anim/humanAnimator";
import type { WolfAnimator } from "../anim/wolfAnimator";
import { WOLF_ATTACKS } from "../anim/wolfAnimator";
import { CLAW, HUMAN, M4A1, MATCH, TRANSFORM, WOLVES, type TeamId, type WolfDef, type WolfId } from "./config";

export type Form = "human" | "wolf";

export interface Intent {
    moveX: number; // right
    moveZ: number; // forward
    yaw: number;
    pitch: number;
    fire: boolean;
    jump: boolean;
    transform: boolean;
    reload: boolean;
    lunge: boolean;
    walk: boolean;
}

export function emptyIntent(): Intent {
    return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, jump: false, transform: false, reload: false, lunge: false, walk: false };
}

export interface HitSphere {
    c: Vector3;
    r: number;
    head: boolean;
}

/** Services the actor needs from the match. */
export interface World {
    moveOnNav(from: Vector3, to: Vector3, out: Vector3): void;
    fireBullet(a: Actor, origin: Vector3, dir: Vector3): void;
    clawStrike(a: Actor, mul: number, kind: "claw" | "lunge"): boolean;
    sound(path: string, pos: Vector3, vol?: number, range?: number): void;
    whoosh(pos: Vector3): void;
    onTransform(a: Actor): void;
    onLand(a: Actor, speed: number): void;
    onFire(a: Actor): void;
}

let nextId = 1;

export class Actor {
    readonly id = nextId++;
    form: Form = "human";
    wolf: WolfDef;
    hp = HUMAN.hp;
    alive = true;
    deadT = 0;
    protectT = 0;
    // physics
    readonly pos = new Vector3();
    readonly navPos = new Vector3();
    readonly vel = new Vector3();
    vy = 0;
    grounded = true;
    airT = 0;
    yaw = 0;
    pitch = 0;
    visYaw = 0;
    // human weapon
    ammo = M4A1.mag;
    reserve = M4A1.reserve;
    reloadT = 0;
    fireT = 0;
    bloom = 0;
    recoil = 0; // camera kick accumulator (local player)
    // wolf combat
    attackT = 0;
    combo = 0;
    comboT = 0;
    lungeT = 0;
    lungeCd = 0;
    // transform
    transformT = -1;
    transformCd = 0;
    // score
    kills = 0;
    deaths = 0;
    assists = 0;
    sp = 0;
    streak = 0;
    wolfStreak = 0;
    readonly damageBy = new Map<number, number>();
    lastHitBy = 0;
    hurtT = 0;
    // visuals (assigned by the match)
    human: ModelInstance | null = null;
    humanAnim: HumanAnimator | null = null;
    gun: TransformNode | null = null;
    wolfModel: ModelInstance | null = null;
    wolfAnim: WolfAnimator | null = null;
    firstPerson = false;
    stepT = 0;
    readonly intent: Intent = emptyIntent();
    private jumpHeld = false;
    private transformHeld = false;
    private lungeHeld = false;
    private readonly tv = new Vector3();
    private readonly tv2 = new Vector3();
    private readonly fwd = new Vector3();

    constructor(
        readonly name: string,
        readonly team: TeamId,
        readonly isBot: boolean,
        wolfId: WolfId,
    ) {
        this.wolf = WOLVES[wolfId];
    }

    get maxHp(): number {
        return this.form === "wolf" ? this.wolf.hp : HUMAN.hp;
    }
    get eyeHeight(): number {
        return this.form === "wolf" ? this.wolf.height * 0.78 : HUMAN.eye;
    }
    get transforming(): boolean {
        return this.transformT >= 0;
    }
    get speed(): number {
        return this.form === "wolf" ? this.wolf.speed : HUMAN.speed;
    }

    eye(out: Vector3): Vector3 {
        return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    }
    chest(out: Vector3): Vector3 {
        return out.set(this.pos.x, this.pos.y + (this.form === "wolf" ? this.wolf.height * 0.55 : 1.25), this.pos.z);
    }
    forward(out: Vector3): Vector3 {
        return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }
    aimDir(out: Vector3): Vector3 {
        const c = Math.cos(this.pitch);
        return out.set(Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c);
    }

    hitSpheres(out: HitSphere[]): HitSphere[] {
        out.length = 0;
        if (!this.alive) return out;
        const p = this.pos;
        if (this.form === "human") {
            out.push({ c: new Vector3(p.x, p.y + 0.42, p.z), r: 0.27, head: false });
            out.push({ c: new Vector3(p.x, p.y + 0.9, p.z), r: 0.3, head: false });
            out.push({ c: new Vector3(p.x, p.y + 1.28, p.z), r: 0.3, head: false });
            out.push({ c: new Vector3(p.x, p.y + 1.64, p.z), r: 0.16, head: true });
        } else {
            const s = this.wolf.height / 2.15;
            const fx = Math.sin(this.visYaw), fz = Math.cos(this.visYaw);
            const at = (f: number, y: number) => new Vector3(p.x + fx * f * s, p.y + y * s, p.z + fz * f * s);
            out.push({ c: at(0, 0.5), r: 0.42 * s, head: false });
            out.push({ c: at(0.05, 1.0), r: 0.5 * s, head: false });
            out.push({ c: at(0.25, 1.38), r: 0.48 * s, head: false });
            out.push({ c: at(0.5, 1.62), r: 0.27 * s, head: true });
        }
        return out;
    }

    spawn(at: Vector3, yaw: number): void {
        this.form = "human";
        this.hp = HUMAN.hp;
        this.alive = true;
        this.deadT = 0;
        this.protectT = MATCH.spawnProtect;
        this.pos.copyFrom(at);
        this.navPos.copyFrom(at);
        this.vel.setAll(0);
        this.vy = 0;
        this.grounded = true;
        this.yaw = yaw;
        this.visYaw = yaw;
        this.pitch = 0;
        this.ammo = M4A1.mag;
        this.reserve = M4A1.reserve;
        this.reloadT = 0;
        this.fireT = 0;
        this.attackT = 0;
        this.combo = 0;
        this.lungeT = 0;
        this.lungeCd = 0;
        this.transformT = -1;
        this.transformCd = 0;
        this.streak = 0;
        this.wolfStreak = 0;
        this.damageBy.clear();
        this.humanAnim?.revive();
        this.wolfAnim?.stopActions();
        this.syncVisibility();
    }

    syncVisibility(): void {
        const showHuman = this.form === "human" && !this.firstPerson;
        this.human?.setVisible(showHuman || (this.form === "human" && !this.alive));
        this.gun?.setEnabled(showHuman || (this.form === "human" && !this.alive));
        this.wolfModel?.setVisible(this.form === "wolf");
    }

    /** Apply damage. Returns true if it killed. */
    damage(amount: number, from: Actor | null): boolean {
        if (!this.alive || this.protectT > 0) return false;
        this.hp -= amount;
        this.hurtT = 0.25;
        if (from) {
            this.damageBy.set(from.id, (this.damageBy.get(from.id) ?? 0) + amount);
            this.lastHitBy = from.id;
        }
        if (this.form === "human") this.humanAnim?.hit(Math.random() < 0.5 ? -1 : 1);
        else if (this.wolfAnim && !this.wolfAnim.busy && Math.random() < 0.5) {
            this.wolfAnim.play({ clip: Math.random() < 0.5 ? "hit_s1" : "hit_s2", to: 20, weight: 0.8, fadeIn: 0.05, fadeOut: 0.15 });
        }
        if (this.hp <= 0) {
            this.hp = 0;
            this.die();
            return true;
        }
        return false;
    }

    die(): void {
        this.alive = false;
        this.deadT = 0;
        this.deaths++;
        this.streak = 0;
        this.wolfStreak = 0;
        this.transformT = -1;
        this.vel.setAll(0);
        if (this.form === "human") this.humanAnim?.die();
        else this.wolfAnim?.play({ clip: "hit_l", to: 42, rate: 0.95, hold: true, fadeIn: 0.06 });
        this.syncVisibility();
    }

    /** Swap the wolf type (respawn choice). The match rebuilds the wolf model. */
    setWolf(id: WolfId): void {
        this.wolf = WOLVES[id];
    }

    update(dt: number, w: World): void {
        const it = this.intent;
        this.protectT = Math.max(0, this.protectT - dt);
        this.hurtT = Math.max(0, this.hurtT - dt);
        if (!this.alive) {
            this.deadT += dt;
            this.integrate(dt, w, 0, 0);
            this.animate(dt);
            return;
        }
        this.yaw = it.yaw;
        this.pitch = Math.max(-1.35, Math.min(1.35, it.pitch));
        this.fireT = Math.max(0, this.fireT - dt);
        this.transformCd = Math.max(0, this.transformCd - dt);
        this.lungeCd = Math.max(0, this.lungeCd - dt);
        this.comboT = Math.max(0, this.comboT - dt);
        this.attackT = Math.max(0, this.attackT - dt);
        this.bloom = Math.max(0, this.bloom - dt * 3.5);

        // ---- transform (shape change at 45% of the transform time)
        if (it.transform && !this.transformHeld && this.transformT < 0 && this.transformCd <= 0 && this.lungeT <= 0) {
            this.transformT = 0;
            this.transformTo = this.form === "human" ? "wolf" : "human";
            this.reloadT = 0;
            w.onTransform(this);
        }
        this.transformHeld = it.transform;
        if (this.transformT >= 0) {
            const before = this.transformT;
            this.transformT += dt;
            const at = TRANSFORM.time * 0.45;
            if (before < at && this.transformT >= at) this.switchForm(this.transformTo);
            if (this.transformT >= TRANSFORM.time) {
                this.transformT = -1;
                this.transformCd = TRANSFORM.cooldown;
            }
        }

        // ---- movement intent
        let mx = it.moveX, mz = it.moveZ;
        const ml = Math.hypot(mx, mz);
        if (ml > 1) {
            mx /= ml;
            mz /= ml;
        }
        let spd = this.speed;
        if (this.form === "human") {
            if (it.walk) spd = HUMAN.walk;
            if (this.reloadT > 0) spd *= 0.85;
            if (mz < -0.1) spd *= 0.85;
        } else if (this.attackT > 0) spd *= 0.55;
        if (this.transforming) spd *= 0.4;
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        // right = (-cos, 0, sin)
        let wx = (mz * sy - mx * cy) * spd, wz = (mz * cy + mx * sy) * spd;
        if (this.lungeT > 0) {
            this.lungeT -= dt;
            wx = sy * CLAW.lungeSpeed;
            wz = cy * CLAW.lungeSpeed;
        }

        // ---- jump
        if (it.jump && !this.jumpHeld && this.grounded && !this.transforming) {
            this.vy = this.form === "wolf" ? this.wolf.jump : HUMAN.jump;
            this.grounded = false;
            this.airT = 0;
            this.wolfAnim?.jump();
            w.sound(this.form === "wolf" ? "movement/wolf_jump.wav" : "human/ziplama_sesi_sadece_huh.mp3", this.pos, this.form === "wolf" ? 0.7 : 0.5, 30);
        }
        this.jumpHeld = it.jump;
        this.integrate(dt, w, wx, wz);

        // ---- weapons
        if (this.form === "human" && !this.transforming) this.updateGun(dt, w);
        else if (this.form === "wolf" && !this.transforming) this.updateClaws(dt, w);
        this.animate(dt);
    }

    transformTo: Form = "wolf";

    private switchForm(to: Form): void {
        const frac = this.hp / this.maxHp;
        this.form = to;
        this.hp = Math.max(1, Math.round(frac * this.maxHp));
        this.attackT = 0;
        this.combo = 0;
        this.lungeT = 0;
        if (to === "wolf") {
            this.wolfAnim?.stopActions();
            this.wolfAnim?.play({ clip: "howl", from: 12, to: 34, rate: 1.35, weight: 0.85, fadeIn: 0.05, fadeOut: 0.2 });
        }
        this.syncVisibility();
    }

    private integrate(dt: number, w: World, wx: number, wz: number): void {
        const accel = this.grounded ? (this.form === "wolf" ? 38 : 45) : 9;
        const k = Math.min(1, accel * dt / Math.max(1, Math.hypot(wx - this.vel.x, wz - this.vel.z)));
        if (this.alive) {
            this.vel.x += (wx - this.vel.x) * Math.min(1, accel * dt * 0.25 + k);
            this.vel.z += (wz - this.vel.z) * Math.min(1, accel * dt * 0.25 + k);
        } else {
            this.vel.x *= Math.max(0, 1 - dt * 6);
            this.vel.z *= Math.max(0, 1 - dt * 6);
        }
        // horizontal along the navmesh
        this.tv.set(this.navPos.x + this.vel.x * dt, this.navPos.y, this.navPos.z + this.vel.z * dt);
        w.moveOnNav(this.navPos, this.tv, this.tv2);
        const movedX = this.tv2.x - this.navPos.x, movedZ = this.tv2.z - this.navPos.z;
        // blocked: kill the velocity component into the wall
        if (dt > 0) {
            const ex = this.vel.x * dt, ez = this.vel.z * dt;
            if (Math.abs(ex) > 1e-5 && Math.abs(movedX / ex) < 0.5) this.vel.x = movedX / dt;
            if (Math.abs(ez) > 1e-5 && Math.abs(movedZ / ez) < 0.5) this.vel.z = movedZ / dt;
        }
        const groundY = this.tv2.y;
        this.navPos.copyFrom(this.tv2);
        this.pos.x = this.navPos.x;
        this.pos.z = this.navPos.z;
        if (this.grounded) {
            if (groundY < this.pos.y - 0.7) {
                // walked off a ledge
                this.grounded = false;
                this.vy = 0;
                this.airT = 0.2;
            } else {
                this.pos.y += (groundY - this.pos.y) * Math.min(1, dt * 18);
            }
        }
        if (!this.grounded) {
            this.airT += dt;
            this.vy -= MATCH.gravity * dt;
            this.pos.y += this.vy * dt;
            if (this.pos.y <= groundY && this.vy <= 0) {
                const impact = -this.vy;
                this.pos.y = groundY;
                this.vy = 0;
                this.grounded = true;
                if (this.airT > 0.25) {
                    this.wolfAnim?.land(impact > 9);
                    w.onLand(this, impact);
                }
                this.airT = 0;
            }
        }
    }

    private updateGun(dt: number, w: World): void {
        const it = this.intent;
        if (this.reloadT > 0) {
            this.reloadT -= dt;
            if (this.reloadT <= 0) {
                const take = Math.min(M4A1.mag - this.ammo, this.reserve);
                this.ammo += take;
                this.reserve -= take;
            }
            return;
        }
        if ((it.reload && this.ammo < M4A1.mag && this.reserve > 0) || (this.ammo === 0 && this.reserve > 0 && it.fire)) {
            this.reloadT = M4A1.reload;
            w.sound("weapons/M4A1/reload.mp3", this.pos, 0.8, 20);
            return;
        }
        if (it.fire && this.fireT <= 0) {
            if (this.ammo <= 0) {
                this.fireT = 0.25;
                w.sound("weapons/M4A1/dry_fire.mp3", this.pos, 0.6, 12);
                return;
            }
            this.fireT += M4A1.interval;
            if (this.fireT < 0) this.fireT = 0;
            this.ammo--;
            const moving = Math.hypot(this.vel.x, this.vel.z) > 1;
            const spread = (this.grounded ? (moving ? M4A1.moveSpread : M4A1.spread) : M4A1.airSpread) + this.bloom * 0.018;
            this.bloom = Math.min(1.6, this.bloom + 0.22);
            const dir = this.aimDir(this.fwd);
            // random cone
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
            const up = new Vector3(0, 1, 0);
            const right = Vector3.Cross(dir, up).normalize();
            const up2 = Vector3.Cross(right, dir).normalize();
            dir.addInPlace(right.scale(Math.cos(a) * r)).addInPlace(up2.scale(Math.sin(a) * r)).normalize();
            const origin = this.eye(this.tv);
            w.fireBullet(this, origin.clone(), dir.clone());
            w.onFire(this);
            this.humanAnim?.fire();
            this.recoil += 1;
        }
    }

    private updateClaws(_dt: number, w: World): void {
        const it = this.intent;
        const anim = this.wolfAnim;
        if (it.lunge && !this.lungeHeld && this.lungeCd <= 0 && this.attackT <= 0 && this.grounded) {
            this.lungeCd = CLAW.lungeCooldown;
            this.attackT = 0.75;
            this.lungeT = CLAW.lungeTime;
            let hitDone = false;
            const strike = () => {
                if (!hitDone && this.alive) hitDone = w.clawStrike(this, CLAW.lungeMul, "lunge");
            };
            anim?.play(WOLF_ATTACKS.lunge, strike);
            w.whoosh(this.pos);
            w.sound(this.wolf.roar, this.pos, 0.55, 35);
            // also check during the dash
            setTimeout(strike, 160);
        }
        this.lungeHeld = it.lunge;
        if (it.fire && this.attackT <= 0) {
            const air = !this.grounded;
            let spec: { clip: string; contact: number; from: number; to: number; rate: number; air?: boolean };
            let mul = 1;
            if (air) {
                spec = WOLF_ATTACKS.claw_air;
                mul = 1.2;
                this.combo = 0;
            } else {
                if (this.comboT <= 0) this.combo = 0;
                spec = this.combo === 0 ? WOLF_ATTACKS.claw_left : this.combo === 1 ? WOLF_ATTACKS.claw_right : WOLF_ATTACKS.claw_finisher;
                if (this.combo === 2) mul = CLAW.finisherMul;
                this.combo = (this.combo + 1) % 3;
            }
            const len = (spec.to - spec.from) / 30 / (spec.rate * this.wolf.rate);
            this.attackT = len * 0.78;
            this.comboT = len + CLAW.comboWindow;
            anim?.play(spec, () => {
                if (this.alive) w.clawStrike(this, mul, "claw");
            });
            setTimeout(() => w.whoosh(this.pos), 60);
        }
    }

    private animate(dt: number): void {
        // body yaw follows the aim (wolves turn quickly, keep the head on target)
        let d = this.yaw - this.visYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.visYaw += d * Math.min(1, dt * (this.form === "wolf" ? 14 : 18));
        const sy = Math.sin(this.visYaw), cy = Math.cos(this.visYaw);
        const fwd = this.vel.x * sy + this.vel.z * cy;
        const right = -this.vel.x * cy + this.vel.z * sy;
        if (this.form === "human" && this.human && this.humanAnim) {
            const root = this.human.root;
            root.position.copyFrom(this.pos);
            root.rotation.y = this.visYaw;
            if (this.human.root.isEnabled()) {
                this.humanAnim.update(dt, fwd, -right, this.pitch, this.grounded);
                if (this.gun) {
                    this.gun.position.copyFrom(this.humanAnim.gun.origin);
                    this.humanAnim.gun.rot.multiplyToRef(GUN_FIX, this.gun.rotationQuaternion!);
                }
            }
        }
        if (this.form === "wolf" && this.wolfModel && this.wolfAnim) {
            const root = this.wolfModel.root;
            root.position.copyFrom(this.pos);
            root.rotation.y = this.visYaw;
            this.wolfAnim.update(dt, this.alive ? fwd : 0, this.alive ? right : 0, this.grounded || !this.alive);
        }
    }
}

/** M4A1 mesh: barrel along -X; rotate so it points down +Z. */
export const GUN_FIX = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.PI / 2);
