import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/loaders/glTF";

// Dev-only model viewer used for measuring assets (not linked from the game).
const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
const cam = new ArcRotateCamera("c", 0.8, 1.0, 60, Vector3.Zero(), scene);
cam.attachControl(canvas, true);
new HemisphericLight("h", new Vector3(0.3, 1, 0.2), scene).intensity = 1.2;
const q = new URLSearchParams(location.search);
const url = q.get("m") ?? "maps/snow_town.glb";
const scale = Number(q.get("s") ?? "1");
const w = window as unknown as Record<string, unknown>;
SceneLoader.ImportMeshAsync("", "", url, scene).then((r) => {
    r.meshes[0].scaling.scaleInPlace(scale);
    r.meshes[0].computeWorldMatrix(true);
    const { min, max } = r.meshes[0].getHierarchyBoundingVectors(true);
    const c = min.add(max).scale(0.5);
    cam.target = c;
    cam.radius = max.subtract(min).length() * 0.8;
    const list = r.meshes.filter((m) => m.getTotalVertices() > 0).map((m) => {
        const b = m.getBoundingInfo().boundingBox;
        return { n: m.name, min: b.minimumWorld.asArray().map((v) => +v.toFixed(2)), max: b.maximumWorld.asArray().map((v) => +v.toFixed(2)), v: m.getTotalVertices() };
    });
    w.info = { min: min.asArray(), max: max.asArray(), meshes: r.meshes.length, list };
    w.ready = true;
});
w.scene = scene;
w.cam = cam;
// eye(x,y,z,yaw): first-person view from a point, with a 1.8 m reference pole beside it
w.eye = (x: number, y: number, z: number, yaw: number) => {
    const u = new UniversalCamera("u", new Vector3(x, y, z), scene);
    u.minZ = 0.05;
    u.fov = 1.1;
    u.rotation.y = yaw;
    scene.activeCamera = u;
    const pole = MeshBuilder.CreateBox("pole", { width: 0.4, depth: 0.4, height: 1.8 }, scene);
    pole.position.set(x + Math.sin(yaw) * 4, y - 1.6 + 0.9, z + Math.cos(yaw) * 4);
};
engine.runRenderLoop(() => scene.render());
