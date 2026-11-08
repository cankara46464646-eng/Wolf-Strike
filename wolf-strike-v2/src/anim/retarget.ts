import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ClipLibrary, Pose } from "./clips";
import { frameQuat, type Rig } from "./rig";

const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];

/**
 * Semantic-frame retarget of the werewolf clips onto a wolf rig.
 * For every bone a frame F is built from joint positions (bone direction + a side/hinge axis) on the
 * source rest pose and on the target bind pose. Then K = F_src · F_tgt⁻¹ · R_bind and, per frame,
 * W = D · K where D is the clip's world-space delta for that bone.
 */
export class Retarget {
    private readonly K: (Quaternion | null)[] = [];
    private readonly src: number[] = [];
    private readonly Ct: Quaternion;
    private readonly CtInv: Quaternion;
    private readonly identityCt: boolean;
    readonly legLen: number; // armature units
    readonly facingFlip: boolean; // target faces -Z in armature space
    private readonly feet: number[];
    private readonly feetBindY: number[];
    private readonly tq = new Quaternion();
    private readonly tq2 = new Quaternion();
    private readonly tv = new Vector3();

    private constructor(readonly rig: Rig, readonly lib: ClipLibrary, flip: boolean) {
        this.facingFlip = flip;
        this.Ct = flip ? new Quaternion(0, 1, 0, 0) : Quaternion.Identity();
        this.CtInv = Quaternion.Inverse(this.Ct);
        this.identityCt = !flip;
        const P = (n: string) => rig.bindPos(n);
        const dist = (a: string, b: string) => {
            const pa = P(a), pb = P(b);
            return pa && pb ? Vector3.Distance(pa, pb) : 0;
        };
        this.legLen = (dist("LeftUpLeg", "LeftLeg") + dist("LeftLeg", "LeftFoot") + dist("RightUpLeg", "RightLeg") + dist("RightLeg", "RightFoot")) / 2;
        this.feet = ["LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot"].map((n) => rig.idx(n));
        this.feetBindY = this.feet.map((i) => (i >= 0 ? rig.bones[i].P.y : 0));

        const h = lib.header;
        const srcPos = (n: string): Vector3 | null => {
            const v = h.restPos[n];
            return v ? new Vector3(v[0], v[1], v[2]).rotateByQuaternionToRef(this.Ct, new Vector3()) : null;
        };
        const srcHinge = (n: string): Vector3 => {
            const v = h.hinge[n];
            if (v) return new Vector3(v[0], v[1], v[2]).rotateByQuaternionToRef(this.Ct, new Vector3());
            return n.endsWith("Arm") ? new Vector3(0, n.startsWith("Left") ? -1 : 1, 0) : new Vector3(1, 0, 0);
        };
        const tgtPos = (n: string): Vector3 | null => (rig.has(n) ? rig.bone(n)!.P.clone() : null);
        const tgtHinge = (n: string): Vector3 => {
            const side = n.startsWith("Left") ? "Left" : "Right";
            const [a, b, c] = n.endsWith("Arm") ? [`${side}Arm`, `${side}ForeArm`, `${side}Hand`] : [`${side}UpLeg`, `${side}Leg`, `${side}Foot`];
            const pa = tgtPos(a), pb = tgtPos(b), pc = tgtPos(c);
            const ref = srcHinge(n);
            if (!pa || !pb || !pc) return ref;
            const u = pb.subtract(pa), l = pc.subtract(pb);
            const x = Vector3.Cross(u, l);
            if (x.length() / Math.max(1e-9, u.length() * l.length()) < 0.2) return ref;
            x.normalize();
            return Vector3.Dot(x, ref) < 0 ? x.scale(-1) : x;
        };
        const qS = new Quaternion(), qT = new Quaternion();
        rig.bones.forEach((b, i) => {
            const si = lib.boneIndex.get(b.name);
            this.src[i] = si ?? -1;
            if (si === undefined) {
                this.K[i] = null;
                return;
            }
            const okS = Retarget.frame(b.name, srcPos, srcHinge, qS);
            const okT = Retarget.frame(b.name, tgtPos, tgtHinge, qT);
            if (!okS || !okT) {
                this.K[i] = b.R.clone();
                return;
            }
            const k = qS.multiply(Quaternion.Inverse(qT));
            this.K[i] = k.multiply(b.R);
        });
    }

    static create(rig: Rig, lib: ClipLibrary): Retarget | null {
        const p = (n: string) => rig.bindPos(n);
        const lt = p("LeftToeBase"), lf = p("LeftFoot"), rt = p("RightToeBase"), rf = p("RightFoot"), la = p("LeftArm"), ra = p("RightArm");
        if (!lt || !lf || !rt || !rf || !la || !ra) return null;
        const flip = lt.z - lf.z + rt.z - rf.z < 0;
        const side = la.subtract(ra);
        if ((flip ? -side.x : side.x) <= 0) {
            console.warn("[WolfStrike] mirrored wolf skeleton - clips disabled");
            return null;
        }
        return new Retarget(rig, lib, flip);
    }

    /** Semantic frame of a bone from a position function. */
    private static frame(name: string, pos: (n: string) => Vector3 | null, hinge: (n: string) => Vector3, out: Quaternion): boolean {
        const s = name.startsWith("Left") ? 1 : name.startsWith("Right") ? -1 : 0;
        const side = s > 0 ? "Left" : "Right";
        const sub = (a: string, b: string): Vector3 | null => {
            const pa = pos(a), pb = pos(b);
            return pa && pb ? pa.subtract(pb) : null;
        };
        const hipsAxis = () => sub("LeftUpLeg", "RightUpLeg");
        const armsAxis = () => sub("LeftArm", "RightArm");
        const palm = (): Vector3 | null => {
            const u = sub(`${side}HandMiddle1`, `${side}Hand`);
            const d = sub(`${side}HandIndex1`, `${side}HandPinky1`);
            return u && d ? Vector3.Cross(u, d).scale(s) : null;
        };
        // primary: towards the child joint, falling back to "away from the parent joint"
        const dir = (child: string, self: string, parent: string): Vector3 | null => sub(child, self) ?? sub(self, parent);
        let c: Vector3 | null = null;
        let f: Vector3 | null = null;
        switch (name) {
            case "Hips":
                c = sub("Spine", "Hips");
                f = hipsAxis();
                break;
            case "Spine":
                c = sub("Spine1", "Spine");
                f = hipsAxis();
                break;
            case "Spine1":
                c = sub("Spine2", "Spine1");
                f = armsAxis();
                break;
            case "Spine2":
                c = sub("Neck", "Spine2");
                f = armsAxis();
                break;
            case "Neck":
                c = sub("Head", "Neck");
                f = armsAxis();
                break;
            case "Head":
                c = sub("Head", "Neck");
                f = armsAxis();
                break;
            default: {
                const part = name.slice(side.length);
                if (part === "Shoulder") {
                    c = sub(`${side}Arm`, `${side}Shoulder`);
                    f = new Vector3(0, 1, 0);
                } else if (part === "Arm") {
                    c = sub(`${side}ForeArm`, `${side}Arm`);
                    f = hinge(`${side}Arm`);
                } else if (part === "ForeArm") {
                    c = sub(`${side}Hand`, `${side}ForeArm`);
                    f = hinge(`${side}Arm`);
                } else if (part === "Hand") {
                    c = sub(`${side}HandMiddle1`, `${side}Hand`);
                    f = palm();
                } else if (part === "UpLeg") {
                    c = sub(`${side}Leg`, `${side}UpLeg`);
                    f = hinge(`${side}UpLeg`);
                } else if (part === "Leg") {
                    c = sub(`${side}Foot`, `${side}Leg`);
                    f = hinge(`${side}UpLeg`);
                } else if (part === "Foot") {
                    c = sub(`${side}ToeBase`, `${side}Foot`);
                    f = hinge(`${side}UpLeg`);
                } else if (part === "ToeBase") {
                    c = sub(`${side}ToeBase`, `${side}Foot`);
                    f = hinge(`${side}UpLeg`);
                } else {
                    const m = /^Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$/.exec(part);
                    if (m && FINGERS.includes(m[1])) {
                        const k = +m[2];
                        const self = `${side}Hand${m[1]}${k}`;
                        const parent = k > 1 ? `${side}Hand${m[1]}${k - 1}` : `${side}Hand`;
                        c = dir(`${side}Hand${m[1]}${k + 1}`, self, parent);
                        f = palm();
                    }
                }
            }
        }
        if (!c || !f || c.lengthSquared() < 1e-12 || f.lengthSquared() < 1e-12) return false;
        return frameQuat(c, f, out);
    }

    private delta(p: Pose, si: number, out: Quaternion): Quaternion {
        const k = si * 4;
        out.set(p.q[k], p.q[k + 1], p.q[k + 2], p.q[k + 3]);
        if (!this.identityCt) {
            this.Ct.multiplyToRef(out, this.tq2);
            this.tq2.multiplyToRef(this.CtInv, out);
        }
        return out;
    }

    /**
     * Pose the rig from a clip pose. groundLow: target lowest-foot height (leg lengths) relative to bind,
     * usually the clip's own lowFoot (lock) or 0 (air: physics owns the height).
     * keepDrift scales the horizontal hips drift (1 = as authored).
     */
    apply(p: Pose, groundLow: number, keepDrift = 1): void {
        const rig = this.rig, bs = rig.bones, L = this.legLen;
        for (let i = 0; i < bs.length; i++) {
            const K = this.K[i];
            const si = this.src[i];
            if (K && si >= 0) this.delta(p, si, this.tq).multiplyToRef(K, bs[i].W);
            else rig.keepLocal(i);
        }
        const hb = bs[0];
        this.tv.set(p.ex[0] * keepDrift, p.ex[1], p.ex[2] * keepDrift).rotateByQuaternionToRef(this.Ct, this.tv);
        hb.X.set(hb.P.x + this.tv.x * L, hb.P.y + this.tv.y * L, hb.P.z + this.tv.z * L);
        rig.solvePositions();
        let low = Infinity;
        for (let k = 0; k < 4; k++) {
            const i = this.feet[k];
            if (i >= 0) low = Math.min(low, bs[i].X.y - this.feetBindY[k]);
        }
        if (low !== Infinity) {
            const dy = groundLow * L - low;
            for (const b of bs) b.X.y += dy;
        }
        rig.write();
    }
}
