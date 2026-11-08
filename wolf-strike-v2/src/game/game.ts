import type { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { RecastJSPlugin } from "@babylonjs/core/Navigation/Plugins/recastJSPlugin";

import { Actor, GUN_FIX, type HitSphere, type World } from "./actor";
import { BotBrain, type BotWorld } from "./bot";
import { CLAW, HUMAN, M4A1, MATCH, TEAMS, TRANSFORM, WOLVES, type TeamId, type WolfId } from "./config";
import { Fx } from "./fx";
import { Input } from "./input";
import { loadMap, SNOW_TOWN } from "./map";
import { instantiate, loadContainer } from "./models";
import { RayGrid } from "./raycast";
import type { Audio } from "./audio";
import { Rig } from "../anim/rig";
import { Retarget } from "../anim/retarget";
import { WolfAnimator } from "../anim/wolfAnimator";
import { HumanAnimator, HUMAN_BONES } from "../anim/humanAnimator";
import { ClipLibrary } from "../anim/clips";
import type { Hud, ScoreRow } from "../ui/hud";

export interface MatchOptions {
    playerName: string;
    wolf: WolfId;
    quality: "low" | "high";
    sens: number;
}

export interface MatchResult {
    win: boolean | null;
    score: [number, number];
    kills: number;
    deaths: number;
    sp: number;
}

const BOT_NAMES = ["Bozkurt", "Tufan", "Kara Kartal", "Akıncı", "Bora", "Yıldırım", "Toprak", "Kurtcan", "Sessiz", "Ateş", "Poyraz", "Demir", "Asi", "Kılıç"];

/** One match: Takım Ölüm Maçı on Karlı Kasaba, the player + bots. */
export class Game implements World, BotWorld {
    scene: Scene;
    camera: FreeCamera;
    actors: Actor[] = [];
    player!: Actor;
    time = 0;
    private bots = new Map<number, BotBrain>();
    private nav!: RecastJSPlugin;
    private rays!: RayGrid;
    private fx!: Fx;
    private input: Input;
    private lib!: ClipLibrary;
    private humanC: AssetContainer[] = [];
    private gunC!: AssetContainer;
    private wolfC = new Map<WolfId, AssetContainer>();
    private viewGun: TransformNode | null = null;
    private viewGunMeshes: AbstractMesh[] = [];
    private spawns: Vector3[][] = [[], []];
    private spawnCenter = [new Vector3(1, 0, -19.4), new Vector3(3.6, 0, 1.4)];
    score: [number, number] = [0, 0];
    private remaining: number = MATCH.duration;
    private state: "countdown" | "live" | "over" = "countdown";
    private countdown = 3.5;
    private warned = { m1: false, s30: false };
    private camDist = 0;
    private orbit = 0;
    private shadows = new Map<number, Mesh>();
    private tagEls = new Map<number, HTMLElement>();
    private hs: HitSphere[] = [];
    private disposed = false;
    private deathSoundAlt = 0;
    private bob = 0;
    private gunKick = 0;
    private lastPlayerPos = new Vector3();
    private footDist = new Map<number, number>();
    private viewport = new Viewport(0, 0, 1, 1);
    onEnd?: (r: MatchResult) => void;

    constructor(private engine: Engine, private hud: Hud, private audio: Audio, private base: string, private opts: MatchOptions) {
        const scene = new Scene(engine);
        scene.useRightHandedSystem = true;
        scene.skipPointerMovePicking = true;
        scene.clearColor = new Color4(0.42, 0.5, 0.62, 1);
        scene.ambientColor = new Color3(0.3, 0.32, 0.36);
        scene.fogMode = Scene.FOGMODE_EXP2;
        scene.fogDensity = 0.016;
        scene.fogColor = new Color3(0.56, 0.62, 0.72);
        this.scene = scene;
        const cam = new FreeCamera("cam", new Vector3(0, 2, 0), scene);
        cam.inputs.clear();
        cam.minZ = 0.04;
        cam.maxZ = 400;
        cam.fov = 1.05;
        this.camera = cam;
        const hemi = new HemisphericLight("hemi", new Vector3(0.1, 1, 0.05), scene);
        hemi.intensity = 0.95;
        hemi.diffuse = new Color3(0.82, 0.88, 1);
        hemi.groundColor = new Color3(0.55, 0.55, 0.6);
        hemi.specular = new Color3(0.1, 0.1, 0.12);
        const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35), scene);
        sun.intensity = 1.5;
        sun.diffuse = new Color3(1, 0.9, 0.78);
        sun.specular = new Color3(0.3, 0.28, 0.25);
        scene.setRenderingAutoClearDepthStencil(1, true, true, false);
        this.makeSky();
        this.input = new Input(engine.getRenderingCanvas()!, hud.root);
        this.input.sensTouch *= opts.sens;
        this.input.sensMouse *= opts.sens;
        this.input.onScoreboard = (s) => hud.scoreboard(s ? this.rows() : null);
        this.input.onPause = () => hud.togglePause();
        hud.onScoreTap = () => hud.scoreboard(this.rows(), true);
    }

    private makeSky(): void {
        const t = new DynamicTexture("skyTex", { width: 4, height: 256 }, this.scene, false);
        const c = t.getContext() as CanvasRenderingContext2D;
        const g = c.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, "#1c2a45");
        g.addColorStop(0.32, "#3c5274");
        g.addColorStop(0.5, "#8fa0b8");
        g.addColorStop(0.56, "#9aa9bf");
        g.addColorStop(1, "#7d8aa0");
        c.fillStyle = g;
        c.fillRect(0, 0, 4, 256);
        t.update();
        const m = new StandardMaterial("sky", this.scene);
        m.emissiveTexture = t;
        m.disableLighting = true;
        m.backFaceCulling = false;
        m.fogEnabled = false;
        const s = MeshBuilder.CreateSphere("sky", { diameter: 600, segments: 16 }, this.scene);
        s.material = m;
        s.infiniteDistance = true;
        s.isPickable = false;
        s.applyFog = false;
        // sphere v runs bottom->top; our gradient image goes top->bottom
        t.vScale = -1;
    }

    // ------------------------------------------------------------------ loading
    async load(progress: (p: number, label: string) => void): Promise<void> {
        const s = this.scene, b = this.base;
        let done = 0;
        const steps = 6;
        const tick = (label: string) => progress(++done / steps, label);
        const wolfIds = new Set<WolfId>(["normal", this.opts.wolf, "smart", "crazy"]);
        const [map, lib, h0, h1, gun] = await Promise.all([
            loadMap(s, "./").then((m) => (tick("Harita"), m)), // v2-only files (public/maps)
            ClipLibrary.load(`${b}clips/ww_clips.json`).then((l) => (tick("Animasyonlar"), l)),
            loadContainer(s, `${b}models/humans/${TEAMS[0].model}`).then((c) => (tick("Öncüler"), c)),
            loadContainer(s, `${b}models/humans/${TEAMS[1].model}`).then((c) => (tick("Yağmacılar"), c)),
            loadContainer(s, `${b}models/weapons/wolfstrike_m4a1.glb`).then((c) => (tick("Silahlar"), c)),
        ]);
        await Promise.all(
            [...wolfIds].map((id) => loadContainer(s, `${b}models/wolves/${WOLVES[id].file}`).then((c) => this.wolfC.set(id, c))),
        );
        tick("Kurtlar");
        this.lib = lib;
        this.nav = map.nav;
        this.humanC = [h0, h1];
        this.gunC = gun;
        this.rays = new RayGrid(map.meshes);
        this.fx = new Fx(s);
        this.tuneMaterials(map.meshes);
        for (const c of [h0, h1, gun, ...this.wolfC.values()]) this.tuneMaterials(c.meshes);
        for (let t = 0; t < 2; t++) {
            const c = this.nav.getClosestPoint(this.spawnCenter[t]);
            this.spawnCenter[t].copyFrom(c);
            for (let i = 0; i < 8; i++) this.spawns[t].push(this.nav.getRandomPointAround(c, 2.6));
        }
        this.setupActors();
        this.setupViewGun();
        await this.audio.preload([
            "weapons/M4A1/fire.mp3", "weapons/M4A1/reload.mp3", "weapons/M4A1/dry_fire.mp3", "movement/footstep.mp3",
            "movement/wolf_jump.wav", "wolves/transform/kurt_donusum.wav", "human/death_01.mp3", "human/death_02.mp3",
            "weapons/shared/impact_flesh_01.mp3", "weapons/shared/impact_flesh_02.mp3", "weapons/shared/impact_concrete_01.mp3",
            "weapons/shared/impact_concrete_02.mp3", "weapons/shared/bullet_flyby_01.mp3", "weapons/shared/bullet_flyby_02.mp3",
            "wolves/roar/yaban_kurt_kukreme_referans.mp3", "human/ziplama_sesi_sadece_huh.mp3",
        ]);
        // compile shaders before the countdown so the first frames are smooth
        await this.scene.whenReadyAsync();
    }

    /** No environment map is shipped: keep PBR metals from rendering black and soften shiny surfaces. */
    private tuneMaterials(meshes: AbstractMesh[]): void {
        for (const m of meshes) {
            const mat = m.material;
            if (mat instanceof PBRMaterial) {
                mat.metallic = Math.min(mat.metallic ?? 0, 0.15);
                mat.roughness = Math.max(mat.roughness ?? 1, 0.55);
                mat.environmentIntensity = 0;
                mat.directIntensity = 1.1;
                mat.ambientColor = new Color3(0.35, 0.37, 0.42);
            }
        }
    }

    private setupActors(): void {
        const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
        const p = new Actor(this.opts.playerName || "Oyuncu", 0, false, this.opts.wolf);
        p.firstPerson = true;
        this.player = p;
        this.actors.push(p);
        for (let t = 0 as TeamId; t < 2; t = (t + 1) as TeamId) {
            const n = t === 0 ? MATCH.teamSize - 1 : MATCH.teamSize;
            for (let i = 0; i < n; i++) {
                const a = new Actor(names.pop() ?? `Bot ${i}`, t, true, Math.random() < 0.7 ? "normal" : Math.random() < 0.5 ? "smart" : "crazy");
                this.actors.push(a);
                this.bots.set(a.id, new BotBrain(a, this));
            }
        }
        for (const a of this.actors) {
            this.buildHuman(a);
            this.buildWolf(a);
            this.shadows.set(a.id, this.fx.blob(`blob${a.id}`, 0.55));
            const i = this.actors.filter((x) => x.team === a.team).indexOf(a);
            const sp = this.spawns[a.team][i % this.spawns[a.team].length];
            a.spawn(sp, this.faceEnemy(a.team, sp));
        }
        this.input.yaw = p.yaw;
        this.input.pitch = 0;
    }

    private buildHuman(a: Actor): void {
        const inst = instantiate(this.scene, this.humanC[a.team], HUMAN.height, `h${a.id}`);
        const rig = new Rig(inst.gltf, HUMAN_BONES);
        a.human = inst;
        a.humanAnim = new HumanAnimator(rig, inst.scale);
        const g = this.gunC.instantiateModelsToScene((n) => `g${a.id}:${n}`, false, { doNotInstantiate: true }).rootNodes[0] as TransformNode;
        g.parent = inst.gltf;
        g.scaling.setAll((0.8 / 0.98) * inst.scale);
        g.rotationQuaternion = new Quaternion();
        for (const m of g.getChildMeshes()) m.isPickable = false;
        a.gun = g;
    }

    private buildWolf(a: Actor): void {
        a.wolfModel?.dispose();
        let c = this.wolfC.get(a.wolf.id);
        if (!c) {
            a.setWolf("normal");
            c = this.wolfC.get("normal")!;
        }
        const inst = instantiate(this.scene, c, a.wolf.height, `w${a.id}`);
        const rig = new Rig(inst.gltf, this.lib.header.bones);
        const rt = Retarget.create(rig, this.lib);
        if (!rt) throw new Error("wolf rig not supported");
        if (rt.facingFlip) inst.gltf.rotation.y = Math.PI;
        const anim = new WolfAnimator(this.lib, rt, rt.legLen / inst.scale);
        anim.rate = a.wolf.rate;
        a.wolfModel = inst;
        a.wolfAnim = anim;
        a.syncVisibility();
    }

    private setupViewGun(): void {
        const e = this.gunC.instantiateModelsToScene((n) => `vg:${n}`, false, { doNotInstantiate: true });
        const g = e.rootNodes[0] as TransformNode;
        g.scaling.setAll((0.8 / 0.98) * 0.52); // drawn in its own depth layer: smaller + closer = a viewmodel FOV
        g.rotationQuaternion = new Quaternion();
        this.viewGunMeshes = g.getChildMeshes();
        for (const m of this.viewGunMeshes) {
            m.renderingGroupId = 1;
            m.isPickable = false;
            m.alwaysSelectAsActiveMesh = true;
        }
        this.viewGun = g;
    }

    /** Face along the navmesh route towards the enemy side (spawns sit in nooks, a straight line hits rock). */
    private faceEnemy(team: number, from: Vector3): number {
        const o = this.spawnCenter[1 - team];
        const path = this.nav ? this.nav.computePath(this.nav.getClosestPoint(from), o) : [];
        let target = o;
        let acc = 0;
        let prev = from;
        for (const p of path) {
            acc += Vector3.Distance(prev, p);
            prev = p;
            target = p;
            if (acc > 1.5) break;
        }
        return Math.atan2(target.x - from.x, target.z - from.z);
    }

    // ------------------------------------------------------------------ World (actor services)
    moveOnNav(from: Vector3, to: Vector3, out: Vector3): void {
        const r = this.nav.moveAlong(from, to);
        // moveAlong keeps the start height; ask the navmesh for the floor under the result
        const c = this.nav.getClosestPoint(r);
        if (c.x === 0 && c.y === 0 && c.z === 0) out.copyFrom(from);
        else out.copyFrom(c);
    }

    path(from: Vector3, to: Vector3): Vector3[] {
        return this.nav.computePath(from, this.nav.getClosestPoint(to));
    }
    randomPoint(near: Vector3, radius: number): Vector3 {
        return this.nav.getRandomPointAround(near, radius);
    }
    los(a: Vector3, b: Vector3): boolean {
        return this.rays.clear(a, b);
    }
    enemySpawn(team: number): Vector3 {
        return this.spawnCenter[1 - team];
    }

    sound(path: string, pos: Vector3, vol = 1, range = 40): void {
        this.audio.play(path, { pos, vol, range });
    }
    whoosh(pos: Vector3): void {
        this.audio.whoosh(pos, 0.45);
    }

    onTransform(a: Actor): void {
        this.fx.transformBurst(a.pos.add(new Vector3(0, 1.1, 0)));
        this.audio.play("wolves/transform/kurt_donusum.wav", { pos: a.pos, vol: 0.85, range: 40 });
        if (a.form === "human") setTimeout(() => this.audio.play(a.wolf.roar, { pos: a.pos, vol: 0.7, range: 45 }), 260);
    }

    onLand(a: Actor, speed: number): void {
        if (speed > 6) this.audio.play("movement/footstep.mp3", { pos: a.pos, vol: 0.6, rate: 0.8, range: 25 });
    }

    onFire(a: Actor): void {
        this.audio.play("weapons/M4A1/fire.mp3", { pos: a.pos, vol: a === this.player ? 0.75 : 0.9, range: 70 });
        if (a === this.player) {
            this.input.addRecoil(M4A1.recoilPitch * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * M4A1.recoilYaw * 2);
            this.gunKick = 1;
            this.fx.flash(this.viewMuzzle(), 0.6);
        } else if (a.gun) {
            const m = Vector3.TransformCoordinates(new Vector3(-0.52, 0.2, 0), a.gun.getWorldMatrix());
            this.fx.flash(m, 0.9);
        }
    }

    fireBullet(a: Actor, origin: Vector3, dir: Vector3): void {
        const range = M4A1.range;
        const n = new Vector3();
        const wallD = this.rays.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, n);
        let best = wallD, victim: Actor | null = null, head = false;
        for (const v of this.actors) {
            if (v === a || !v.alive || v.team === a.team) continue;
            // touch players get a little bullet magnetism
            const assist = a === this.player && this.input.touch ? 0.14 : 0;
            for (const s of v.hitSpheres(this.hs)) {
                const d = raySphere(origin, dir, s.c, s.r + (s.head ? assist * 0.3 : assist));
                if (d >= 0 && d < best) {
                    best = d;
                    victim = v;
                    head = s.head;
                }
            }
        }
        const end = origin.add(dir.scale(Math.min(best, range)));
        // tracer starts from the visible muzzle
        const from = a === this.player ? this.viewMuzzle() : a.gun ? Vector3.TransformCoordinates(new Vector3(-0.52, 0.2, 0), a.gun.getWorldMatrix()) : origin;
        if (a !== this.player || Math.random() < 0.5) this.fx.tracer(from, end);
        if (victim) {
            const dmg = M4A1.damage * (head ? M4A1.headMul : 1) * (victim.form === "wolf" ? M4A1.wolfMul : 1) * (0.92 + Math.random() * 0.16);
            this.fx.blood(end, dir.scale(-1));
            this.audio.play(`weapons/shared/impact_flesh_0${1 + (Math.random() < 0.5 ? 1 : 0)}.mp3`, { pos: end, vol: 0.5, range: 20, minGap: 0.05 });
            this.applyDamage(victim, a, dmg, origin, head ? "head" : "M4A1");
        } else if (wallD !== Infinity) {
            this.fx.impact(end, n);
            if (Vector3.DistanceSquared(end, this.camera.position) < 900) this.audio.play(`weapons/shared/impact_concrete_0${1 + (Math.random() < 0.5 ? 1 : 0)}.mp3`, { pos: end, vol: 0.35, range: 25, minGap: 0.06 });
        }
        // flyby for the local player
        const p = this.player;
        if (a.team !== p.team && p.alive && victim !== p) {
            const e = p.eye(new Vector3());
            const t = Vector3.Dot(e.subtract(origin), dir);
            if (t > 2 && t < best) {
                const closest = origin.add(dir.scale(t));
                if (Vector3.Distance(closest, e) < 1.4) this.audio.play(`weapons/shared/bullet_flyby_0${1 + (Math.random() < 0.5 ? 1 : 0)}.mp3`, { vol: 0.45, minGap: 0.25 });
            }
        }
    }

    clawStrike(a: Actor, mul: number, kind: "claw" | "lunge"): boolean {
        let any = false;
        const fwd = a.forward(new Vector3());
        const eye = a.chest(new Vector3());
        const reach = CLAW.range * (a.wolf.height / 2.15) * (kind === "lunge" ? 1.15 : 1);
        for (const v of this.actors) {
            if (v === a || !v.alive || v.team === a.team) continue;
            const to = v.pos.subtract(a.pos);
            const dy = to.y;
            to.y = 0;
            const d = to.length();
            if (d > reach + 0.35 || Math.abs(dy) > CLAW.reach) continue;
            if (d > 0.6 && Vector3.Dot(to.scale(1 / d), fwd) < Math.cos(CLAW.angle)) continue;
            if (!this.rays.clear(eye, v.chest(new Vector3()))) continue;
            const dmg = a.wolf.claw * mul * (0.9 + Math.random() * 0.2);
            const at = v.chest(new Vector3());
            this.fx.blood(at, fwd);
            this.audio.play(`weapons/shared/impact_flesh_0${1 + (Math.random() < 0.5 ? 1 : 0)}.mp3`, { pos: at, vol: 0.8, range: 25 });
            this.applyDamage(v, a, dmg, a.pos, kind === "lunge" ? "ATILMA" : "PENÇE");
            // knockback
            v.vel.x += fwd.x * (kind === "lunge" ? 7 : 3);
            v.vel.z += fwd.z * (kind === "lunge" ? 7 : 3);
            any = true;
        }
        return any;
    }

    private applyDamage(v: Actor, from: Actor, dmg: number, srcPos: Vector3, weapon: string): void {
        if (this.state === "over") return;
        const wasProtected = v.protectT > 0;
        const killed = v.damage(dmg, from);
        if (wasProtected) return;
        if (from === this.player) {
            this.hud.hitmarker(weapon === "head", killed);
            this.audio.tick(weapon === "head");
        }
        if (v === this.player) {
            const ang = Math.atan2(srcPos.x - v.pos.x, srcPos.z - v.pos.z) - v.yaw;
            this.hud.damage(ang);
        }
        if (killed) this.onKill(v, from, weapon);
    }

    private onKill(v: Actor, k: Actor, weapon: string): void {
        k.kills++;
        k.sp += MATCH.spKill;
        k.streak++;
        if (k.form === "wolf") k.wolfStreak++;
        this.score[k.team]++;
        for (const [id, dmg] of v.damageBy) {
            if (id === k.id) continue;
            const a = this.actors.find((x) => x.id === id);
            if (a && a.team !== v.team && dmg >= 25) {
                a.assists++;
                a.sp += MATCH.spAssist;
                if (a === this.player) this.hud.toast(`ASİST +${MATCH.spAssist} SP`);
            }
        }
        this.hud.killfeed(k.name, TEAMS[k.team].color, v.name, TEAMS[v.team].color, weapon === "head" ? "M4A1 ✦" : weapon, k === this.player || v === this.player);
        // death sounds
        if (v.form === "human") {
            this.deathSoundAlt = 1 - this.deathSoundAlt;
            this.audio.play(`human/death_0${this.deathSoundAlt + 1}.mp3`, { pos: v.pos, vol: 0.85, range: 35 });
        } else this.audio.play(v.wolf.roar, { pos: v.pos, vol: 0.7, rate: 0.75, range: 40 });
        if (k === this.player) {
            this.hud.toast(`+${MATCH.spKill} SP`);
            const s = k.streak;
            const lines: Record<number, string> = { 2: "ikide iki.mp3", 3: "üçte üç.mp3", 4: "dörtte dört.mp3", 5: "beşte beş.mp3" };
            const wl: Record<number, string> = { 6: "vahşi kurt.mp3", 8: "SAVAŞÇI KURT.mp3", 10: "EFSANE KURT!.mp3", 12: "KURTLARIN EFENDİSİ.mp3" };
            if (k.form === "wolf" && wl[k.wolfStreak]) this.audio.announce(wl[k.wolfStreak], 4);
            else if (lines[s]) this.audio.announce(lines[s], 5);
        }
        if (v === this.player) {
            this.hud.deathPanel(k.name, this.player, MATCH.respawn, (id) => this.chooseWolf(id));
        }
        if (this.score[k.team] >= MATCH.killLimit) this.finish();
    }

    chooseWolf(id: WolfId): void {
        const p = this.player;
        if (WOLVES[id].sp > p.sp) return;
        if (!this.wolfC.has(id)) {
            void loadContainer(this.scene, `${this.base}models/wolves/${WOLVES[id].file}`).then((c) => {
                this.tuneMaterials(c.meshes);
                this.wolfC.set(id, c);
                this.pendingWolf = id;
            });
        } else this.pendingWolf = id;
        this.hud.markWolf(id);
    }
    private pendingWolf: WolfId | null = null;

    private respawn(a: Actor): void {
        let want: WolfId | null = null;
        if (a === this.player) want = this.pendingWolf;
        else if (a.isBot) {
            const opts = (Object.keys(WOLVES) as WolfId[]).filter((id) => WOLVES[id].sp <= a.sp && this.wolfC.has(id));
            if (opts.length && Math.random() < 0.6) want = opts[Math.floor(Math.random() * opts.length)];
        }
        if (want && want !== a.wolf.id) {
            a.setWolf(want);
            this.buildWolf(a);
        }
        if (a === this.player) this.pendingWolf = null;
        // farthest spawn from visible enemies
        const list = this.spawns[a.team];
        let best = list[0], bestScore = -Infinity;
        for (const s of list) {
            let minD = 60;
            for (const e of this.actors) if (e.alive && e.team !== a.team) minD = Math.min(minD, Vector3.Distance(e.pos, s));
            const score = minD + Math.random() * 3;
            if (score > bestScore) {
                bestScore = score;
                best = s;
            }
        }
        a.spawn(best, this.faceEnemy(a.team, best));
        this.bots.get(a.id)?.reset();
        if (a === this.player) {
            this.input.yaw = a.yaw;
            this.input.pitch = 0;
            this.hud.deathPanel(null);
        }
    }

    // ------------------------------------------------------------------ loop
    start(): void {
        this.hud.show(true);
        this.hud.setTouch(this.input.touch);
        this.hud.message("3", "HAZIRLAN", 0);
        this.audio.music(null);
        this.scene.onBeforeRenderObservable.add(() => this.frame());
    }

    private frame(): void {
        if (this.disposed) return;
        this.step(Math.min(0.05, this.engine.getDeltaTime() / 1000));
    }

    /** Advance the match by dt seconds (also used by the headless test harness). */
    step(dt: number): void {
        if (this.hud.paused) {
            this.input.enabled = false;
            return;
        }
        this.time += dt;
        if (this.state === "countdown") {
            const before = Math.ceil(this.countdown);
            this.countdown -= dt;
            const now = Math.ceil(this.countdown);
            if (now !== before && now > 0) this.hud.message(String(now), "HAZIRLAN", 0);
            if (this.countdown <= 0) {
                this.state = "live";
                this.input.enabled = true;
                this.hud.message("SAVAŞ!", "Bölgedeki tüm düşmanları haklayın", 1.6);
                this.audio.announce("Bölgedeki tüm düşmanları haklayın.mp3", 2);
            }
        } else if (this.state === "live") {
            this.remaining -= dt;
            if (!this.warned.m1 && this.remaining <= 60) {
                this.warned.m1 = true;
                this.audio.announce("SON 1 DAKİKA.mp3", 2);
            }
            if (!this.warned.s30 && this.remaining <= 30) {
                this.warned.s30 = true;
                this.audio.announce("SON 30 SANİYE.mp3", 2);
            }
            if (this.remaining <= 0) {
                this.remaining = 0;
                this.finish();
            }
        }
        // intents
        const p = this.player;
        if (this.state === "live" && p.alive) this.input.fill(p.intent);
        else {
            const it = p.intent;
            this.input.fill(it);
            it.fire = it.jump = it.transform = it.reload = it.lunge = false;
            if (this.state !== "live") it.moveX = it.moveZ = 0;
        }
        for (const [id, b] of this.bots) {
            const a = this.actors.find((x) => x.id === id)!;
            if (this.state === "live") b.update(dt);
            else {
                a.intent.moveX = a.intent.moveZ = 0;
                a.intent.fire = false;
                a.intent.yaw = a.yaw;
            }
        }
        // simulate
        for (const a of this.actors) {
            a.update(dt, this);
            if (!a.alive && a.deadT >= MATCH.respawn && this.state === "live") this.respawn(a);
            const sh = this.shadows.get(a.id)!;
            sh.position.set(a.pos.x, a.navPos.y + 0.03, a.pos.z);
            const s = a.form === "wolf" ? a.wolf.height / 2.15 : 0.7;
            sh.scaling.set(s, 1, s);
            sh.setEnabled(a.alive || a.deadT < 3);
            this.footsteps(a, dt);
        }
        this.updateCamera(dt);
        this.fx.update(dt, this.camera);
        this.audio.setListener(this.camera.position, p.yaw);
        this.updateHud();
    }

    private footsteps(a: Actor, dt: number): void {
        if (!a.alive || !a.grounded) return;
        const sp = Math.hypot(a.vel.x, a.vel.z);
        if (sp < 1) return;
        const d = (this.footDist.get(a.id) ?? 0) + sp * dt;
        const stride = a.form === "wolf" ? 1.9 : 1.6;
        if (d >= stride) {
            this.footDist.set(a.id, 0);
            if (Vector3.DistanceSquared(a.pos, this.camera.position) < 900) {
                const own = a === this.player;
                this.audio.play("movement/footstep.mp3", { pos: own ? undefined : a.pos, vol: (a.form === "wolf" ? 0.55 : 0.38) * (own ? 0.6 : 1), rate: a.form === "wolf" ? 0.82 + Math.random() * 0.08 : 0.95 + Math.random() * 0.1, range: 28 });
            }
        } else this.footDist.set(a.id, d);
    }

    private viewMuzzle(): Vector3 {
        if (!this.viewGun) return this.camera.position.clone();
        return Vector3.TransformCoordinates(new Vector3(-0.5, 0.21, 0), this.viewGun.getWorldMatrix());
    }

    private updateCamera(dt: number): void {
        const p = this.player, cam = this.camera;
        const yaw = this.input.yaw, pitch = this.input.pitch;
        const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        let wantDist = p.form === "wolf" ? 3.3 * (p.wolf.height / 2.15) : 0;
        if (p.transforming) wantDist = Math.max(wantDist, 2.2);
        if (!p.alive) wantDist = 4.2;
        this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 7);
        const firstPerson = this.camDist < 0.25 && p.alive;
        if (p.firstPerson !== firstPerson) {
            p.firstPerson = firstPerson;
            p.syncVisibility();
        }
        const eye = new Vector3(p.pos.x, p.pos.y + (p.form === "wolf" || !p.alive ? (p.alive ? p.wolf.height * 0.8 : 1.2) : HUMAN.eye), p.pos.z);
        let pos: Vector3;
        if (!p.alive) {
            this.orbit += dt * 0.35;
            const od = new Vector3(Math.sin(yaw + this.orbit) * 0.9, 0.55, Math.cos(yaw + this.orbit) * 0.9).normalize();
            pos = eye.subtract(od.scale(this.camDist));
            const look = eye;
            pos = this.cameraCollide(look, pos);
            cam.position.copyFrom(pos);
            cam.setTarget(look);
        } else if (firstPerson) {
            // view bob
            const sp = Math.hypot(p.vel.x, p.vel.z);
            if (p.grounded && sp > 0.5) this.bob += dt * sp * 1.9;
            const bobY = Math.sin(this.bob * 2) * 0.018 * Math.min(1, sp / 4);
            pos = eye.add(new Vector3(0, bobY, 0));
            cam.position.copyFrom(pos);
            cam.setTarget(pos.add(dir));
        } else {
            const right = new Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
            const pivot = eye.add(new Vector3(0, 0.25, 0)).add(right.scale(0.45 * Math.min(1, this.camDist / 2)));
            const want = pivot.subtract(dir.scale(this.camDist));
            pos = this.cameraCollide(pivot, want);
            cam.position.copyFrom(pos);
            cam.setTarget(pos.add(dir));
        }
        cam.fov = p.form === "wolf" ? 1.15 : 1.05;
        // first-person gun
        const vg = this.viewGun!;
        const showVG = firstPerson && p.form === "human" && p.alive;
        vg.setEnabled(showVG);
        if (showVG) {
            this.gunKick = Math.max(0, this.gunKick - dt * 10);
            const sp = Math.hypot(p.vel.x, p.vel.z);
            const sway = Math.sin(this.bob) * 0.012 * Math.min(1, sp / 4);
            const reloadK = p.reloadT > 0 ? Math.sin(Math.min(1, (M4A1.reload - p.reloadT) / M4A1.reload) * Math.PI) : 0;
            const tr = p.transforming ? Math.min(1, p.transformT / (TRANSFORM.time * 0.45)) : 0;
            const q = Quaternion.RotationYawPitchRoll(yaw, -pitch, 0);
            const local = new Vector3(-0.125 + sway * 0.6, -0.15 - reloadK * 0.07 - tr * 0.18 + Math.abs(sway) * 0.25, 0.27 - this.gunKick * 0.02);
            const world = local.rotateByQuaternionToRef(q, new Vector3()).addInPlace(cam.position);
            vg.position.copyFrom(world);
            const kickQ = Quaternion.RotationAxis(new Vector3(1, 0, 0), -this.gunKick * 0.05 + reloadK * 0.5);
            const rollQ = Quaternion.RotationAxis(new Vector3(0, 0, 1), reloadK * 0.6);
            q.multiplyToRef(kickQ.multiply(rollQ).multiply(GUN_FIX), vg.rotationQuaternion!);
        }
        this.lastPlayerPos.copyFrom(p.pos);
    }

    private cameraCollide(from: Vector3, to: Vector3): Vector3 {
        const d = to.subtract(from);
        const l = d.length();
        if (l < 0.01) return to;
        d.scaleInPlace(1 / l);
        const hit = this.rays.raycast(from.x, from.y, from.z, d.x, d.y, d.z, l + 0.3);
        if (hit === Infinity) return to;
        return from.add(d.scale(Math.max(0.3, hit - 0.3)));
    }

    // ------------------------------------------------------------------ HUD
    private updateHud(): void {
        const p = this.player;
        this.hud.update({
            hp: p.hp,
            maxHp: p.maxHp,
            form: p.form,
            wolfName: p.wolf.name,
            ammo: p.ammo,
            reserve: p.reserve,
            reload: p.reloadT > 0 ? 1 - p.reloadT / M4A1.reload : -1,
            lunge: p.lungeCd / CLAW.lungeCooldown,
            transform: p.transforming ? 1 : p.transformCd / TRANSFORM.cooldown,
            sp: p.sp,
            score: this.score,
            time: this.remaining,
            limit: MATCH.killLimit,
            alive: p.alive,
            respawn: p.alive ? 0 : Math.max(0, MATCH.respawn - p.deadT),
            protect: p.protectT > 0,
            spread: p.form === "human" ? (p.grounded ? (Math.hypot(p.vel.x, p.vel.z) > 1 ? M4A1.moveSpread : M4A1.spread) : M4A1.airSpread) + p.bloom * 0.018 : 0,
        });
        // name tags
        const vp = this.viewport;
        const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
        const tm = this.scene.getTransformMatrix();
        const ui = this.hud.root.getBoundingClientRect();
        const aimDir = new Vector3(Math.sin(this.input.yaw) * Math.cos(this.input.pitch), Math.sin(this.input.pitch), Math.cos(this.input.yaw) * Math.cos(this.input.pitch));
        const camPos = this.camera.position;
        for (const a of this.actors) {
            if (a === p) continue;
            let el = this.tagEls.get(a.id);
            if (!el) {
                el = this.hud.tag(a.name, TEAMS[a.team].color, a.team === p.team);
                this.tagEls.set(a.id, el);
            }
            const head = new Vector3(a.pos.x, a.pos.y + (a.form === "wolf" ? a.wolf.height * 1.02 : 2.05), a.pos.z);
            const toA = head.subtract(camPos);
            const dist = toA.length();
            let show = a.alive && Vector3.Dot(toA, aimDir) > 0 && dist < 45;
            if (show && a.team !== p.team) {
                // enemies: only when under the crosshair and visible
                const ang = Math.acos(Math.min(1, Vector3.Dot(toA.normalizeToNew(), aimDir)));
                show = ang < Math.max(0.05, 0.9 / dist) && this.rays.clear(camPos, a.chest(new Vector3()));
            } else if (show) show = dist < 35;
            if (!show) {
                if (el.style.display !== "none") el.style.display = "none";
                continue;
            }
            const sp = Vector3.Project(head, Matrix.IdentityReadOnly, tm, vp);
            el.style.display = "";
            el.style.transform = `translate(${(sp.x * ui.width).toFixed(1)}px, ${(sp.y * ui.height).toFixed(1)}px) translate(-50%, -100%)`;
            void w;
            void h;
        }
    }

    private rows(): ScoreRow[] {
        return this.actors
            .map((a) => ({ name: a.name, team: a.team, kills: a.kills, deaths: a.deaths, assists: a.assists, sp: a.sp, me: a === this.player, bot: a.isBot, alive: a.alive, form: a.form }))
            .sort((x, y) => y.kills - x.kills || x.deaths - y.deaths);
    }

    private finish(): void {
        if (this.state === "over") return;
        this.state = "over";
        this.input.enabled = false;
        this.input.reset();
        if (document.pointerLockElement) document.exitPointerLock();
        const [a, b] = this.score;
        const win = a === b ? null : a > b;
        this.audio.announce(win === false ? "kaybettin.mp3" : "ZAFER!.mp3", 1);
        if (win === null) this.hud.message("BERABERE", `${a} - ${b}`, 0);
        const p = this.player;
        setTimeout(() => {
            if (this.disposed) return;
            this.hud.endPanel(win, this.score, this.rows(), () => this.onEnd?.({ win, score: this.score, kills: p.kills, deaths: p.deaths, sp: p.sp }));
        }, 1800);
    }

    quit(): void {
        this.finish();
    }

    dispose(): void {
        this.disposed = true;
        this.input.enabled = false;
        this.input.reset();
        for (const el of this.tagEls.values()) el.remove();
        this.scene.dispose();
    }
}

function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number): number {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    const t = -b - s;
    if (t >= 0) return t;
    const t2 = -b + s;
    return t2 >= 0 ? 0 : -1;
}

export const MAP_CREDIT = SNOW_TOWN.credit;
