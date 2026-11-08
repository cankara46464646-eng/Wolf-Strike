import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";

/** "mixamorig:LeftArm" / "Clone of mixamorig:LeftArm" -> "leftarm" */
export function boneKey(name: string): string {
    let n = name;
    const i = Math.max(n.lastIndexOf(":"), n.lastIndexOf("|"));
    if (i >= 0) n = n.slice(i + 1);
    n = n.replace(/^mixamorig[_\s]?/i, "");
    return n.toLowerCase();
}

export interface RigBone {
    name: string; // canonical (e.g. "LeftArm")
    node: TransformNode;
    parent: number; // index in Rig.bones, -1 for the root (Hips)
    localPos: Vector3; // bind local position
    localRot: Quaternion; // bind local rotation
    scale: number; // node's own uniform scale
    R: Quaternion; // bind rotation in armature space
    P: Vector3; // bind position in armature space
    S: number; // accumulated scale (applies to children's local positions)
    // working pose (armature space)
    W: Quaternion;
    X: Vector3;
}

/**
 * Skeleton view over the glTF bone TransformNodes, in "armature space" (the Hips parent's space).
 * Rotations are Hamilton products (Babylon's Quaternion.multiply), world = parent * local.
 */
export class Rig {
    readonly bones: RigBone[] = [];
    readonly index = new Map<string, number>();
    private readonly tq = new Quaternion();
    private readonly tv = new Vector3();

    constructor(root: Node, names: readonly string[]) {
        const byKey = new Map<string, TransformNode>();
        for (const n of root.getDescendants(false)) {
            const k = boneKey(n.name);
            if (!byKey.has(k) && (n as TransformNode).position) byKey.set(k, n as TransformNode);
        }
        const wanted = new Map<string, string>();
        for (const nm of names) wanted.set(nm.toLowerCase(), nm);
        const hips = byKey.get("hips");
        if (!hips) throw new Error("rig: Hips not found");
        // depth-first from Hips so parents come first
        const visit = (node: TransformNode, parent: number) => {
            const canon = wanted.get(boneKey(node.name));
            let me = parent;
            if (canon && !this.index.has(canon)) {
                if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
                const s = node.scaling.x;
                const b: RigBone = {
                    name: canon,
                    node,
                    parent,
                    localPos: node.position.clone(),
                    localRot: node.rotationQuaternion.clone(),
                    scale: s,
                    R: new Quaternion(),
                    P: new Vector3(),
                    S: 1,
                    W: new Quaternion(),
                    X: new Vector3(),
                };
                if (parent < 0) {
                    b.R.copyFrom(b.localRot);
                    b.P.copyFrom(b.localPos);
                    b.S = s;
                } else {
                    const p = this.bones[parent];
                    p.R.multiplyToRef(b.localRot, b.R);
                    b.localPos.scale(p.S).rotateByQuaternionToRef(p.R, b.P);
                    b.P.addInPlace(p.P);
                    b.S = p.S * s;
                }
                b.W.copyFrom(b.R);
                b.X.copyFrom(b.P);
                me = this.bones.length;
                this.index.set(canon, me);
                this.bones.push(b);
            }
            for (const c of node.getChildren()) {
                if ((c as TransformNode).position) visit(c as TransformNode, me);
            }
        };
        visit(hips, -1);
    }

    has(name: string): boolean {
        return this.index.has(name);
    }
    idx(name: string): number {
        return this.index.get(name) ?? -1;
    }
    bone(name: string): RigBone | undefined {
        const i = this.index.get(name);
        return i === undefined ? undefined : this.bones[i];
    }
    bindPos(name: string): Vector3 | null {
        return this.bone(name)?.P ?? null;
    }

    /** Positions of all bones from their working world rotations W and the root position (already in bones[0].X). */
    solvePositions(): void {
        const bs = this.bones;
        for (let i = 1; i < bs.length; i++) {
            const b = bs[i];
            const p = bs[b.parent];
            b.localPos.scaleToRef(p.S, this.tv);
            this.tv.rotateByQuaternionToRef(p.W, b.X);
            b.X.addInPlace(p.X);
        }
    }

    /** Set W of a bone from the parent's W and the bind local rotation. */
    keepLocal(i: number): void {
        const b = this.bones[i];
        if (b.parent < 0) b.W.copyFrom(b.localRot);
        else this.bones[b.parent].W.multiplyToRef(b.localRot, b.W);
    }

    /** Write the working pose to the nodes. */
    write(): void {
        const bs = this.bones;
        for (let i = 0; i < bs.length; i++) {
            const b = bs[i];
            const q = b.node.rotationQuaternion!;
            if (b.parent < 0) q.copyFrom(b.W);
            else {
                Quaternion.InverseToRef(bs[b.parent].W, this.tq);
                this.tq.multiplyToRef(b.W, q);
            }
        }
        bs[0].node.position.copyFrom(bs[0].X);
    }

    resetToBind(): void {
        for (const b of this.bones) {
            b.W.copyFrom(b.R);
            b.X.copyFrom(b.P);
        }
    }
}

/** Orthonormal frame quaternion with primary axis c (x) and secondary hint f (y). */
export function frameQuat(c: Vector3, f: Vector3, out: Quaternion): boolean {
    const x = c.clone();
    if (x.lengthSquared() < 1e-12) return false;
    x.normalize();
    const d = Vector3.Dot(f, x);
    const y = new Vector3(f.x - x.x * d, f.y - x.y * d, f.z - x.z * d);
    if (y.lengthSquared() < 1e-10) return false;
    y.normalize();
    const z = Vector3.Cross(x, y);
    // rotation matrix with columns x, y, z -> quaternion
    const m00 = x.x, m01 = y.x, m02 = z.x;
    const m10 = x.y, m11 = y.y, m12 = z.y;
    const m20 = x.z, m21 = y.z, m22 = z.z;
    const tr = m00 + m11 + m22;
    if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        out.set((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s);
    } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        out.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
    } else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        out.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
    } else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        out.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
    }
    out.normalize();
    return true;
}

/** Rotation taking unit-ish vector a onto b (shortest arc). */
export function fromTo(a: Vector3, b: Vector3, out: Quaternion): Quaternion {
    const al = a.length() || 1, bl = b.length() || 1;
    const ax = a.x / al, ay = a.y / al, az = a.z / al;
    const bx = b.x / bl, by = b.y / bl, bz = b.z / bl;
    const d = ax * bx + ay * by + az * bz;
    if (d < -0.999999) {
        // 180°: any perpendicular axis
        let px = 0, py = -az, pz = ay;
        if (px * px + py * py + pz * pz < 1e-6) {
            px = -az; py = 0; pz = ax;
        }
        const l = Math.hypot(px, py, pz);
        return out.set(px / l, py / l, pz / l, 0);
    }
    out.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx, 1 + d);
    return out.normalize();
}
