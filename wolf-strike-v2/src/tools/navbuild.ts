import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { loadMapGeometry, loadRecast, buildNav } from "../game/map";

// Dev-only: builds the navmesh for the map and exposes it for saving (public/maps/*.nav.bin).
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;
new HemisphericLight("h", new Vector3(0.2, 1, 0.3), scene).intensity = 1.1;
const cam = new FreeCamera("c", new Vector3(0, 120, 0.01), scene);
cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
const w = window as unknown as Record<string, unknown>;
(async () => {
    const t0 = performance.now();
    const [{ meshes }, recast] = await Promise.all([loadMapGeometry(scene, "./"), loadRecast()]);
    const skip = (new URLSearchParams(location.search).get("skip") ?? "").split(",").filter(Boolean);
    const nav = buildNav(recast, meshes.filter((m) => !skip.includes(m.name)));
    const data = nav.getNavmeshData();
    const dbg = nav.createDebugNavMesh(scene);
    const m = new StandardMaterial("m", scene);
    m.diffuseColor = new Color3(0.1, 0.9, 0.3);
    m.alpha = 0.55;
    dbg.material = m;
    dbg.position.y += 0.05;
    const bb = dbg.getBoundingInfo().boundingBox;
    const half = Math.max(bb.maximumWorld.x - bb.minimumWorld.x, bb.maximumWorld.z - bb.minimumWorld.z) / 2 + 2;
    const ar = engine.getRenderWidth() / engine.getRenderHeight();
    cam.orthoTop = half; cam.orthoBottom = -half; cam.orthoLeft = -half * ar; cam.orthoRight = half * ar;
    cam.position.set((bb.maximumWorld.x + bb.minimumWorld.x) / 2, 120, (bb.maximumWorld.z + bb.minimumWorld.z) / 2 + 0.01);
    cam.setTarget(new Vector3(cam.position.x, 0, cam.position.z - 0.01));
    // sample reachable points for spawn planning
    const pts: number[][] = [];
    for (let i = 0; i < 400; i++) {
        const p = nav.getRandomPointAround(new Vector3(0, 0, 0), 60);
        pts.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
    }
    let b64 = "";
    for (let i = 0; i < data.length; i += 0x8000) b64 += String.fromCharCode(...data.subarray(i, i + 0x8000));
    w.nav = btoa(b64);
    w.info = { ms: Math.round(performance.now() - t0), bytes: data.length, navMin: bb.minimumWorld.asArray(), navMax: bb.maximumWorld.asArray(), pts };
    w.navPlugin = nav;
    w.V3 = Vector3;
    w.scene = scene;
    w.mark = (x: number, z: number, r: number, g: number, b: number, size = 0.8) => {
        const m = MeshBuilder.CreateSphere("mk", { diameter: size }, scene);
        m.position.set(x, 30, z);
        const mt = new StandardMaterial("mk", scene);
        mt.emissiveColor = new Color3(r, g, b);
        mt.disableLighting = true;
        m.material = mt;
    };
    w.Ray = (await import("@babylonjs/core/Culling/ray")).Ray;
    w.ready = true;
})().catch((e) => { console.error(e); w.err = String(e?.stack || e); w.ready = true; });
engine.runRenderLoop(() => scene.render());
