import type { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { BoxParticleEmitter } from "@babylonjs/core/Particles/EmitterTypes/boxParticleEmitter";

function radial(scene: Scene, name: string, inner: string, outer: string, size = 64): DynamicTexture {
    const t = new DynamicTexture(name, { width: size, height: size }, scene, false);
    const c = t.getContext() as CanvasRenderingContext2D;
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    t.update();
    t.hasAlpha = true;
    return t;
}

interface Tracer {
    mesh: Mesh;
    t: number;
}

/** Pooled combat effects: impacts, blood, tracers, muzzle flashes, transform bursts, falling snow, blob shadows. */
export class Fx {
    private puffTex: DynamicTexture;
    private impacts: ParticleSystem[] = [];
    private bloods: ParticleSystem[] = [];
    private bursts: ParticleSystem[] = [];
    private ii = 0;
    private bi = 0;
    private ti = 0;
    private ri = 0;
    private tracers: Tracer[] = [];
    private flashes: { mesh: Mesh; t: number }[] = [];
    private fi = 0;
    readonly shadowMat: StandardMaterial;
    private snow: ParticleSystem;

    constructor(private scene: Scene) {
        this.puffTex = radial(scene, "puff", "rgba(255,255,255,1)", "rgba(255,255,255,0)");
        for (let i = 0; i < 8; i++) this.impacts.push(this.makeBurst(`imp${i}`, new Color4(0.92, 0.93, 0.96, 0.9), new Color4(0.7, 0.72, 0.78, 0), 0.08, 0.22, 10, 2.5));
        for (let i = 0; i < 8; i++) this.bloods.push(this.makeBurst(`bld${i}`, new Color4(0.55, 0.02, 0.02, 1), new Color4(0.25, 0, 0, 0), 0.06, 0.18, 14, 3.5));
        for (let i = 0; i < 3; i++) {
            const b = this.makeBurst(`tf${i}`, new Color4(0.12, 0.1, 0.12, 0.9), new Color4(0.05, 0.03, 0.05, 0), 0.5, 1.3, 40, 3);
            b.color1 = new Color4(0.45, 0.05, 0.05, 0.85);
            this.bursts.push(b);
        }
        const tm = new StandardMaterial("tracer", scene);
        tm.emissiveColor = new Color3(1, 0.86, 0.55);
        tm.disableLighting = true;
        tm.alphaMode = Constants.ALPHA_ADD;
        tm.alpha = 0.9;
        for (let i = 0; i < 12; i++) {
            const m = MeshBuilder.CreateBox(`tr${i}`, { width: 0.018, height: 0.018, depth: 1 }, scene);
            m.material = tm;
            m.isPickable = false;
            m.setEnabled(false);
            m.rotationQuaternion = new Quaternion();
            this.tracers.push({ mesh: m, t: 0 });
        }
        const fm = new StandardMaterial("flash", scene);
        fm.emissiveTexture = radial(scene, "flashTex", "rgba(255,240,200,1)", "rgba(255,140,30,0)");
        fm.opacityTexture = fm.emissiveTexture;
        fm.disableLighting = true;
        fm.alphaMode = Constants.ALPHA_ADD;
        fm.backFaceCulling = false;
        for (let i = 0; i < 6; i++) {
            const m = MeshBuilder.CreatePlane(`fl${i}`, { size: 0.32 }, scene);
            m.material = fm;
            m.billboardMode = 7;
            m.isPickable = false;
            m.setEnabled(false);
            this.flashes.push({ mesh: m, t: 0 });
        }
        this.shadowMat = new StandardMaterial("blob", scene);
        this.shadowMat.diffuseColor = Color3.Black();
        this.shadowMat.specularColor = Color3.Black();
        this.shadowMat.opacityTexture = radial(scene, "blobTex", "rgba(0,0,0,0.55)", "rgba(0,0,0,0)");
        this.shadowMat.disableLighting = true;
        this.shadowMat.zOffset = -2;
        // falling snow around the camera
        const s = new ParticleSystem("snow", 900, scene);
        s.particleTexture = this.puffTex;
        const em = new BoxParticleEmitter();
        em.minEmitBox = new Vector3(-14, 6, -14);
        em.maxEmitBox = new Vector3(14, 9, 14);
        em.direction1 = new Vector3(-0.3, -1, -0.2);
        em.direction2 = new Vector3(0.3, -1, 0.3);
        s.particleEmitterType = em;
        s.emitter = Vector3.Zero();
        s.minSize = 0.03;
        s.maxSize = 0.07;
        s.minLifeTime = 4;
        s.maxLifeTime = 6;
        s.emitRate = 160;
        s.minEmitPower = 1.2;
        s.maxEmitPower = 2;
        s.color1 = new Color4(1, 1, 1, 0.85);
        s.color2 = new Color4(0.9, 0.93, 1, 0.65);
        s.colorDead = new Color4(1, 1, 1, 0);
        s.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        s.updateSpeed = 0.016;
        s.start();
        this.snow = s;
    }

    private makeBurst(name: string, c1: Color4, dead: Color4, minS: number, maxS: number, count: number, power: number): ParticleSystem {
        const p = new ParticleSystem(name, count * 2, this.scene);
        p.particleTexture = this.puffTex;
        p.emitter = Vector3.Zero();
        p.minEmitBox = new Vector3(-0.04, -0.04, -0.04);
        p.maxEmitBox = new Vector3(0.04, 0.04, 0.04);
        p.color1 = c1;
        p.color2 = c1;
        p.colorDead = dead;
        p.minSize = minS;
        p.maxSize = maxS;
        p.minLifeTime = 0.25;
        p.maxLifeTime = 0.55;
        p.emitRate = 0;
        p.manualEmitCount = 0;
        p.minEmitPower = power * 0.4;
        p.maxEmitPower = power;
        p.direction1 = new Vector3(-1, 0.4, -1);
        p.direction2 = new Vector3(1, 1.6, 1);
        p.gravity = new Vector3(0, -6, 0);
        p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        p.updateSpeed = 0.016;
        p.start();
        return p;
    }

    private fire(p: ParticleSystem, at: Vector3, n: number, normal?: Vector3): void {
        (p.emitter as Vector3).copyFrom(at);
        if (normal) {
            p.direction1 = normal.add(new Vector3(-0.6, -0.2, -0.6));
            p.direction2 = normal.add(new Vector3(0.6, 0.8, 0.6));
        }
        p.manualEmitCount = n;
    }

    impact(at: Vector3, normal: Vector3): void {
        this.fire(this.impacts[this.ii++ % this.impacts.length], at, 9, normal);
    }
    blood(at: Vector3, dir?: Vector3): void {
        this.fire(this.bloods[this.bi++ % this.bloods.length], at, 12, dir);
    }
    transformBurst(at: Vector3): void {
        this.fire(this.bursts[this.ri++ % this.bursts.length], at, 36);
    }

    tracer(a: Vector3, b: Vector3): void {
        const tr = this.tracers[this.ti++ % this.tracers.length];
        const d = b.subtract(a);
        const len = d.length();
        if (len < 0.5) return;
        // only a streak segment, not the whole line
        const seg = Math.min(len * 0.6, 7);
        const start = a.add(d.scale(Math.min(0.25, 2 / len)));
        tr.mesh.position.copyFrom(start.add(d.normalizeToNew().scale(seg / 2)));
        tr.mesh.scaling.set(1, 1, seg);
        const dn = d.normalize();
        Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), dn, tr.mesh.rotationQuaternion!);
        tr.mesh.setEnabled(true);
        tr.t = 0.05;
    }

    flash(at: Vector3, size = 1): void {
        const f = this.flashes[this.fi++ % this.flashes.length];
        f.mesh.position.copyFrom(at);
        f.mesh.scaling.setAll(size * (0.8 + Math.random() * 0.4));
        f.mesh.rotation.z = Math.random() * Math.PI;
        f.mesh.setEnabled(true);
        f.t = 0.045;
    }

    blob(name: string, radius: number): Mesh {
        const m = MeshBuilder.CreateGround(name, { width: radius * 2, height: radius * 2 }, this.scene);
        m.material = this.shadowMat;
        m.isPickable = false;
        return m;
    }

    update(dt: number, cam: Camera): void {
        for (const t of this.tracers) {
            if (t.t > 0) {
                t.t -= dt;
                if (t.t <= 0) t.mesh.setEnabled(false);
            }
        }
        for (const f of this.flashes) {
            if (f.t > 0) {
                f.t -= dt;
                if (f.t <= 0) f.mesh.setEnabled(false);
            }
        }
        (this.snow.emitter as Vector3).copyFrom(cam.globalPosition);
    }

    setSnow(on: boolean): void {
        if (on) this.snow.start();
        else this.snow.stop();
    }
}
