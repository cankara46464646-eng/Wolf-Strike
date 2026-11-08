import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { fromTo, type Rig } from "./rig";

export const HUMAN_BONES = [
    "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
] as const;

/** Where the rifle sits relative to the character (model space, metres before model scale): x = left, z = forward. */
export interface GunPose {
    grip: Vector3; // right hand
    fore: Vector3; // left hand
    origin: Vector3; // gun node position
    rot: Quaternion; // gun node rotation (model space)
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Procedural soldier animation on a Mixamo-style rig (no clips are shipped for humans):
 * stepping legs with two-bone IK, a rifle-ready upper body with both hands on the weapon (IK),
 * aim pitch spread over the spine, hit flinch and a fall-down death.
 * Model space = rig armature space (Y up, character faces +Z, left = +X), units = model units.
 */
export class HumanAnimator {
    private phase = 0;
    private moveX = 0; // smoothed local velocity, model units/s (x = left)
    private moveZ = 0;
    private flinch = 0;
    private flinchSide = 0;
    private recoil = 0;
    dead = 0; // 0..1 fall progress (driven by update when dying)
    private dying = false;
    private deathT = 0;
    readonly gun: GunPose = { grip: new Vector3(), fore: new Vector3(), origin: new Vector3(), rot: new Quaternion() };
    private readonly i: Record<string, number> = {};
    private readonly up = new Vector3(0, 1, 0);
    private readonly hipsBind: Vector3;
    private readonly footBind: [Vector3, Vector3];
    private readonly thigh: [number, number];
    private readonly shin: [number, number];
    private readonly upperArm: [number, number];
    private readonly foreArm: [number, number];
    private readonly height: number;
    private readonly tq = new Quaternion();
    private readonly tq2 = new Quaternion();
    private readonly tv = new Vector3();
    private readonly tv2 = new Vector3();

    constructor(readonly rig: Rig, readonly unitsPerMetre: number) {
        for (const n of HUMAN_BONES) this.i[n] = rig.idx(n);
        const P = (n: string) => rig.bone(n)!.P;
        this.hipsBind = P("Hips").clone();
        this.footBind = [P("LeftFoot").clone(), P("RightFoot").clone()];
        this.thigh = [Vector3.Distance(P("LeftUpLeg"), P("LeftLeg")), Vector3.Distance(P("RightUpLeg"), P("RightLeg"))];
        this.shin = [Vector3.Distance(P("LeftLeg"), P("LeftFoot")), Vector3.Distance(P("RightLeg"), P("RightFoot"))];
        this.upperArm = [Vector3.Distance(P("LeftArm"), P("LeftForeArm")), Vector3.Distance(P("RightArm"), P("RightForeArm"))];
        this.foreArm = [Vector3.Distance(P("LeftForeArm"), P("LeftHand")), Vector3.Distance(P("RightForeArm"), P("RightHand"))];
        this.height = P("Head").y * 1.08;
    }

    hit(side: number): void {
        this.flinch = 1;
        this.flinchSide = side;
    }
    fire(): void {
        this.recoil = 1;
    }
    die(): void {
        this.dying = true;
        this.deathT = 0;
    }
    revive(): void {
        this.dying = false;
        this.dead = 0;
        this.deathT = 0;
    }

    /** fwd/left in m/s (model space), pitch in radians (+ = looking up). */
    update(dt: number, fwd: number, left: number, pitch: number, grounded: boolean): void {
        const rig = this.rig, bs = rig.bones, u = this.unitsPerMetre;
        const k = Math.min(1, dt * 10);
        this.moveX += (left * u - this.moveX) * k;
        this.moveZ += (fwd * u - this.moveZ) * k;
        const spd = Math.hypot(this.moveX, this.moveZ); // model units / s
        const spdM = spd / u;
        // gait: stride grows with speed; cadence = speed / (2 * stride)
        const stride = Math.min(0.62 * this.height, 0.18 * this.height + spdM * 0.11 * this.height);
        if (spdM > 0.15) this.phase = (this.phase + dt * Math.max(0.9, Math.min(2.4, spd / (2 * stride)))) % 1;
        else this.phase += (Math.round(this.phase * 2) / 2 - this.phase) * Math.min(1, dt * 6); // settle feet
        const moving = Math.min(1, spdM / 1.2);
        const dirX = spd > 1e-4 ? this.moveX / spd : 0, dirZ = spd > 1e-4 ? this.moveZ / spd : 1;
        this.flinch = Math.max(0, this.flinch - dt * 4);
        this.recoil = Math.max(0, this.recoil - dt * 9);
        if (this.dying) {
            this.deathT += dt;
            this.dead = Math.min(1, this.deathT / 0.7);
        }

        // ---- start from bind locals
        for (let i = 0; i < bs.length; i++) rig.keepLocal(i);
        const hips = bs[this.i.Hips];
        const bob = moving * (Math.abs(Math.cos(this.phase * Math.PI * 2)) * 0.022 - 0.03) * this.height;
        hips.X.set(this.hipsBind.x, this.hipsBind.y - 0.025 * this.height + bob, this.hipsBind.z);
        // hips: lean into movement + twist with stride
        const lean = moving * 0.12 * Math.sign(dirZ || 1) * Math.min(1, Math.abs(dirZ) + 0.3);
        const twist = moving * Math.sin(this.phase * Math.PI * 2) * 0.12;
        this.rotWorld(this.i.Hips, Quaternion.RotationAxis(this.up, twist).multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), lean * 0.4)));
        // spine: counter twist, aim pitch, flinch, recoil
        const aim = Math.max(-1.1, Math.min(1.1, pitch));
        const spineBones = [this.i.Spine, this.i.Spine1, this.i.Spine2];
        for (let s = 0; s < spineBones.length; s++) {
            const pitchShare = -aim / 3 + lean * 0.25 - this.recoil * 0.03 - this.flinch * 0.12;
            const q = Quaternion.RotationAxis(new Vector3(1, 0, 0), pitchShare)
                .multiply(Quaternion.RotationAxis(this.up, -twist / 2 + this.flinchSide * this.flinch * 0.15 + 0.12 * (s === 2 ? 1 : 0)));
            this.relRotWorld(spineBones[s], q);
        }
        rig.keepLocal(this.i.Neck);
        this.relRotWorld(this.i.Neck, Quaternion.RotationAxis(this.up, -0.18));
        rig.keepLocal(this.i.Head);
        this.relRotWorld(this.i.Head, Quaternion.RotationAxis(new Vector3(1, 0, 0), -aim * 0.15));
        // limbs follow the adjusted torso
        const torso = new Set([this.i.Hips, this.i.Spine, this.i.Spine1, this.i.Spine2, this.i.Neck, this.i.Head]);
        for (let i = 0; i < bs.length; i++) if (!torso.has(i)) rig.keepLocal(i);
        rig.solvePositions();

        // ---- legs (two-bone IK, feet flat)
        for (let s = 0; s < 2; s++) {
            const side = s === 0 ? "Left" : "Right";
            const ph = (this.phase + s * 0.5) % 1;
            let along: number, lift: number;
            if (ph < 0.5) {
                along = stride / 2 - stride * (ph / 0.5);
                lift = 0;
            } else {
                const t = (ph - 0.5) / 0.5;
                along = -stride / 2 + stride * smooth(t);
                lift = Math.sin(Math.PI * t) * (0.05 + 0.05 * moving) * this.height;
            }
            along *= moving;
            lift *= moving;
            const fb = this.footBind[s];
            const target = this.tv.set(fb.x + dirX * along, fb.y + lift, fb.z + dirZ * along);
            if (!grounded) {
                target.y += 0.12 * this.height;
                target.z += (s === 0 ? 0.08 : -0.05) * this.height;
            }
            this.twoBone(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, target, new Vector3(0, 0, 1), this.thigh[s], this.shin[s]);
            // feet keep their bind world orientation (flat)
            const f = bs[this.i[`${side}Foot`]];
            f.W.copyFrom(f.R);
            rig.keepLocal(this.i[`${side}ToeBase`]);
        }

        // ---- rifle + arms
        const H = this.height;
        const shoulderY = bs[this.i.RightArm].X.y;
        const chest = bs[this.i.Spine2];
        // aim pivot near the right shoulder, gun rotated by pitch around the x axis (left)
        const pivot = new Vector3(-0.06 * H, shoulderY - 0.02 * H, chest.X.z + 0.04 * H);
        const pitchQ = Quaternion.RotationAxis(new Vector3(1, 0, 0), -aim);
        const off = (x: number, y: number, z: number) => {
            const v = new Vector3(x * H, y * H, (z - this.recoil * 0.02) * H);
            v.rotateByQuaternionToRef(pitchQ, v);
            return v.addInPlace(pivot);
        };
        this.gun.origin.copyFrom(off(0.0, -0.07, 0.2));
        this.gun.rot.copyFrom(pitchQ);
        this.gun.grip.copyFrom(off(-0.005, -0.1, 0.14));
        this.gun.fore.copyFrom(off(0.01, -0.06, 0.36));
        this.twoBone("RightArm", "RightForeArm", "RightHand", this.gun.grip, new Vector3(-1, -1.4, -0.2), this.upperArm[1], this.foreArm[1]);
        this.twoBone("LeftArm", "LeftForeArm", "LeftHand", this.gun.fore, new Vector3(0.6, -1.2, -0.3), this.upperArm[0], this.foreArm[0]);
        // hands: point along the gun
        this.aimHand("RightHand", new Vector3(0, -0.3, 1).rotateByQuaternionToRef(pitchQ, new Vector3()));
        this.aimHand("LeftHand", new Vector3(-0.3, -0.2, 1).rotateByQuaternionToRef(pitchQ, new Vector3()));

        // ---- death: fall backwards around the feet
        if (this.dead > 0) {
            const d = this.dead;
            const fall = Quaternion.RotationAxis(new Vector3(1, 0, 0), -smooth(d) * 1.45);
            const pivotY = 0;
            for (const b of bs) {
                fall.multiplyToRef(b.W, b.W);
                b.X.y -= pivotY;
                b.X.rotateByQuaternionToRef(fall, b.X);
                b.X.y += pivotY;
            }
            this.gun.origin.rotateByQuaternionToRef(fall, this.gun.origin);
            fall.multiplyToRef(this.gun.rot, this.gun.rot);
            // settle on the ground (the body lies at ~0.1 H)
            hips.X.y += d * 0.06 * H;
        }
        rig.write();
    }

    /** Apply a world-space rotation to a bone (and implicitly its children, which follow via keepLocal later). */
    private rotWorld(i: number, q: Quaternion): void {
        const b = this.rig.bones[i];
        q.multiplyToRef(b.W, b.W);
    }
    /** Rebuild W from parent then apply an extra world rotation about the bone. */
    private relRotWorld(i: number, q: Quaternion): void {
        this.rig.keepLocal(i);
        const b = this.rig.bones[i];
        q.multiplyToRef(b.W, b.W);
    }

    private twoBone(a: string, b: string, c: string, target: Vector3, pole: Vector3, l1: number, l2: number): void {
        const rig = this.rig, bs = rig.bones;
        const ia = this.i[a], ib = this.i[b], ic = this.i[c];
        rig.keepLocal(ia);
        rig.solvePositions();
        const A = bs[ia].X;
        const toT = target.subtract(A);
        let d = toT.length();
        const maxD = (l1 + l2) * 0.999, minD = Math.abs(l1 - l2) + 1e-4;
        d = Math.max(minD, Math.min(maxD, d));
        const dir = toT.normalize();
        // elbow/knee position in the plane of dir and pole
        const pd = Vector3.Dot(pole, dir);
        const perp = pole.subtract(dir.scale(pd));
        if (perp.lengthSquared() < 1e-8) perp.copyFrom(Vector3.Cross(dir, new Vector3(1, 0, 0)));
        perp.normalize();
        const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
        const sinA = Math.sqrt(1 - cosA * cosA);
        const E = A.add(dir.scale(l1 * cosA)).addInPlace(perp.scale(l1 * sinA));
        const T = A.add(dir.scale(d));
        // swing upper bone to E
        const cur = bs[ib].X.subtract(A);
        fromTo(cur, E.subtract(A), this.tq);
        this.tq.multiplyToRef(bs[ia].W, bs[ia].W);
        rig.keepLocal(ib);
        rig.solvePositions();
        const cur2 = bs[ic].X.subtract(bs[ib].X);
        fromTo(cur2, T.subtract(bs[ib].X), this.tq2);
        this.tq2.multiplyToRef(bs[ib].W, bs[ib].W);
        rig.keepLocal(ic);
        rig.solvePositions();
    }

    private aimHand(name: string, dir: Vector3): void {
        const rig = this.rig, bs = rig.bones;
        const i = this.i[name];
        rig.keepLocal(i);
        const b = bs[i];
        // hand bone axis in bind = direction towards the middle finger ~ local +Y in Mixamo rigs
        this.tv2.set(0, 1, 0).rotateByQuaternionToRef(b.W, this.tv2);
        fromTo(this.tv2, dir, this.tq);
        // only partially, keeps wrists natural
        Quaternion.SlerpToRef(Quaternion.Identity(), this.tq, 0.7, this.tq);
        this.tq.multiplyToRef(b.W, b.W);
    }
}
