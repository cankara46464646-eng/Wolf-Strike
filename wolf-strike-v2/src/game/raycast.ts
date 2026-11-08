import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * World-space triangle soup in a 2D (xz) uniform grid for fast ray queries:
 * bullets, line of sight and camera collision. Much cheaper than scene picking on the
 * 65k-vertex terrain mesh on phones.
 */
export class RayGrid {
    private tris: Float32Array;
    private cells: Int32Array[] = [];
    private stamp: Uint32Array;
    private frame = 1;
    private minX = 0;
    private minZ = 0;
    private nx = 0;
    private nz = 0;
    constructor(meshes: AbstractMesh[], readonly cell = 1.5) {
        const all: number[] = [];
        const v = new Vector3();
        for (const m of meshes) {
            const pos = m.getVerticesData(VertexBuffer.PositionKind);
            const idx = m.getIndices();
            if (!pos || !idx) continue;
            const wm = m.computeWorldMatrix(true);
            const w = new Float32Array(pos.length);
            for (let i = 0; i < pos.length; i += 3) {
                Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, v);
                w[i] = v.x; w[i + 1] = v.y; w[i + 2] = v.z;
            }
            for (let i = 0; i < idx.length; i += 3) {
                const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
                all.push(w[a], w[a + 1], w[a + 2], w[b], w[b + 1], w[b + 2], w[c], w[c + 1], w[c + 2]);
            }
        }
        this.tris = new Float32Array(all);
        const n = this.tris.length / 9;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i < this.tris.length; i += 3) {
            x0 = Math.min(x0, this.tris[i]); x1 = Math.max(x1, this.tris[i]);
            z0 = Math.min(z0, this.tris[i + 2]); z1 = Math.max(z1, this.tris[i + 2]);
        }
        this.minX = x0;
        this.minZ = z0;
        this.nx = Math.max(1, Math.ceil((x1 - x0) / cell));
        this.nz = Math.max(1, Math.ceil((z1 - z0) / cell));
        const lists: number[][] = Array.from({ length: this.nx * this.nz }, () => []);
        const t = this.tris;
        for (let k = 0; k < n; k++) {
            const o = k * 9;
            const ax = Math.min(t[o], t[o + 3], t[o + 6]), bx = Math.max(t[o], t[o + 3], t[o + 6]);
            const az = Math.min(t[o + 2], t[o + 5], t[o + 8]), bz = Math.max(t[o + 2], t[o + 5], t[o + 8]);
            const cx0 = this.cx(ax), cx1 = this.cx(bx), cz0 = this.cz(az), cz1 = this.cz(bz);
            for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) lists[cz * this.nx + cx].push(k);
        }
        this.cells = lists.map((l) => Int32Array.from(l));
        this.stamp = new Uint32Array(n);
    }

    get triangleCount(): number {
        return this.tris.length / 9;
    }

    private cx(x: number): number {
        return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell)));
    }
    private cz(z: number): number {
        return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cell)));
    }

    /**
     * Distance along the (normalised) direction to the first triangle hit within maxDist, or Infinity.
     * If outNormal is given it receives the hit triangle's normal (facing the ray origin).
     */
    raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, outNormal?: Vector3): number {
        if (++this.frame > 0xfffffff0) {
            this.stamp.fill(0);
            this.frame = 1;
        }
        const st = this.stamp, fr = this.frame, t = this.tris;
        let best = maxDist;
        let bestTri = -1;
        // 2D DDA across xz cells
        const c = this.cell;
        let ix = Math.floor((ox - this.minX) / c), iz = Math.floor((oz - this.minZ) / c);
        const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
        const hd = Math.hypot(dx, dz);
        const tDeltaX = Math.abs(dx) > 1e-9 ? c / Math.abs(dx) : Infinity;
        const tDeltaZ = Math.abs(dz) > 1e-9 ? c / Math.abs(dz) : Infinity;
        let tMaxX = Math.abs(dx) > 1e-9 ? ((stepX > 0 ? (ix + 1) * c + this.minX - ox : ox - (ix * c + this.minX)) / Math.abs(dx)) : Infinity;
        let tMaxZ = Math.abs(dz) > 1e-9 ? ((stepZ > 0 ? (iz + 1) * c + this.minZ - oz : oz - (iz * c + this.minZ)) / Math.abs(dz)) : Infinity;
        let tCell = 0;
        const vertical = hd < 1e-6;
        for (let guard = 0; guard < 4096; guard++) {
            if (ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz) {
                const list = this.cells[iz * this.nx + ix];
                for (let j = 0; j < list.length; j++) {
                    const k = list[j];
                    if (st[k] === fr) continue;
                    st[k] = fr;
                    const o = k * 9;
                    // Möller–Trumbore (double-sided)
                    const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2];
                    const e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
                    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                    const det = e1x * px + e1y * py + e1z * pz;
                    if (det > -1e-9 && det < 1e-9) continue;
                    const inv = 1 / det;
                    const sx = ox - t[o], sy = oy - t[o + 1], sz = oz - t[o + 2];
                    const u = (sx * px + sy * py + sz * pz) * inv;
                    if (u < 0 || u > 1) continue;
                    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
                    const vv = (dx * qx + dy * qy + dz * qz) * inv;
                    if (vv < 0 || u + vv > 1) continue;
                    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
                    if (d > 1e-4 && d < best) {
                        best = d;
                        bestTri = k;
                    }
                }
            }
            if (vertical) break;
            // nothing in later cells can be closer than this cell's exit distance
            if (best <= Math.min(tMaxX, tMaxZ)) break;
            if (tMaxX < tMaxZ) {
                tCell = tMaxX;
                tMaxX += tDeltaX;
                ix += stepX;
            } else {
                tCell = tMaxZ;
                tMaxZ += tDeltaZ;
                iz += stepZ;
            }
            if (tCell > best || tCell > maxDist) break;
            if ((ix < 0 && stepX < 0) || (iz < 0 && stepZ < 0) || (ix >= this.nx && stepX > 0) || (iz >= this.nz && stepZ > 0)) break;
        }
        if (bestTri >= 0 && outNormal) {
            const o = bestTri * 9;
            const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2];
            const e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
            outNormal.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
            if (outNormal.x * dx + outNormal.y * dy + outNormal.z * dz > 0) outNormal.scaleInPlace(-1);
        }
        return bestTri >= 0 ? best : Infinity;
    }

    /** True when the segment a→b is unobstructed. */
    clear(a: Vector3, b: Vector3): boolean {
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const l = Math.hypot(dx, dy, dz);
        if (l < 1e-4) return true;
        return this.raycast(a.x, a.y, a.z, dx / l, dy / l, dz / l, l - 0.05) === Infinity;
    }
}
