import type { Scene } from "@babylonjs/core/scene";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/loaders/glTF";

const containers = new Map<string, Promise<AssetContainer>>();

export function loadContainer(scene: Scene, url: string): Promise<AssetContainer> {
    let p = containers.get(url);
    if (!p) {
        p = LoadAssetContainerAsync(url, scene).then((c) => {
            // keep the source meshes out of the scene; instances are cloned from it
            return c;
        });
        containers.set(url, p);
    }
    return p;
}

let uid = 0;

export interface ModelInstance {
    /** moved / yawed by the game */
    root: TransformNode;
    /** scaled + offset so the soles sit on root's origin */
    inner: TransformNode;
    /** glTF root ("__root__") */
    gltf: TransformNode;
    meshes: AbstractMesh[];
    /** model units per metre (inner scale) */
    scale: number;
    setVisible(v: boolean): void;
    dispose(): void;
}

/**
 * Clone a loaded model into the scene, scaled to `height` metres with its soles at the root origin.
 */
export function instantiate(scene: Scene, c: AssetContainer, height: number, name: string): ModelInstance {
    const id = ++uid;
    const entries = c.instantiateModelsToScene((n) => `${name}#${id}:${n}`, false, { doNotInstantiate: true });
    const gltf = entries.rootNodes[0] as TransformNode;
    const root = new TransformNode(`${name}#${id}`, scene);
    const inner = new TransformNode(`${name}#${id}:inner`, scene);
    inner.parent = root;
    gltf.parent = inner;
    const meshes = gltf.getChildMeshes(false);
    gltf.computeWorldMatrix(true);
    let minY = Infinity, maxY = -Infinity;
    for (const m of meshes) {
        m.computeWorldMatrix(true);
        m.refreshBoundingInfo({ applySkeleton: false });
        const bb = m.getBoundingInfo().boundingBox;
        minY = Math.min(minY, bb.minimumWorld.y);
        maxY = Math.max(maxY, bb.maximumWorld.y);
    }
    const h = Math.max(1e-3, maxY - minY);
    const s = height / h;
    inner.scaling.setAll(s);
    inner.position.y = -minY * s;
    for (const m of meshes) {
        m.alwaysSelectAsActiveMesh = true; // skinned bounds lag behind the pose; cheap with few actors
        m.isPickable = false;
    }
    return {
        root,
        inner,
        gltf,
        meshes,
        scale: 1 / s,
        setVisible(v: boolean) {
            root.setEnabled(v);
        },
        dispose() {
            for (const sk of entries.skeletons) sk.dispose();
            root.dispose(false, false);
        },
    };
}

export const ZERO = Vector3.Zero();
