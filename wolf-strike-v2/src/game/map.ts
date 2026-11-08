import type { Scene } from "@babylonjs/core/scene";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { RecastJSPlugin } from "@babylonjs/core/Navigation/Plugins/recastJSPlugin";
import type { INavMeshParameters } from "@babylonjs/core/Navigation/INavigationEngine";
import Recast from "recast-detour";
import "@babylonjs/loaders/glTF";

/**
 * "Karlı Kasaba" — snow_town.glb by Pasha (CC-BY-4.0, Sketchfab). Authored as a miniature,
 * so it is scaled up to human size and recentred on the plaza.
 */
export const SNOW_TOWN = {
    id: "karli_kasaba",
    name: "KARLI KASABA",
    url: "maps/snow_town.glb",
    nav: "maps/snow_town.nav.bin",
    scale: 3,
    center: new Vector3(90.96, 64.1, 0), // source units (glTF space, right-handed)
    credit: "\"Snow Town\" by Pasha (sketchfab.com/3d-models/snow-town-29ffaa4c9d5644179464f7847c1d6649), CC BY 4.0",
};

export const NAV_PARAMS: INavMeshParameters = {
    cs: 0.2,
    ch: 0.15,
    walkableSlopeAngle: 50,
    walkableHeight: 11, // 1.65 m
    walkableClimb: 6, // 0.9 m (scaled-up curbs and stair steps)
    walkableRadius: 2, // 0.4 m
    maxEdgeLen: 40,
    maxSimplificationError: 1.3,
    minRegionArea: 24,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 3,
    detailSampleMaxError: 0.5,
};

export interface GameMap {
    root: TransformNode;
    meshes: AbstractMesh[];
    nav: RecastJSPlugin;
    /** meshes that block bullets / sight */
    solid: AbstractMesh[];
}

let recastP: Promise<unknown> | null = null;
export function loadRecast(): Promise<unknown> {
    // the module assigns this.Recast internally; give it a receiver (undefined in ES modules)
    if (!recastP) recastP = (Recast as unknown as (this: object) => Promise<unknown>).call({});
    return recastP;
}

export async function loadMapGeometry(scene: Scene, base: string): Promise<{ root: TransformNode; meshes: AbstractMesh[] }> {
    const c = await LoadAssetContainerAsync(base + SNOW_TOWN.url, scene);
    c.addAllToScene();
    const root = new TransformNode("map", scene);
    const s = SNOW_TOWN.scale;
    root.scaling.setAll(s);
    root.position.copyFrom(SNOW_TOWN.center.scale(-s));
    for (const n of c.rootNodes) n.parent = root;
    const meshes = c.meshes.filter((m) => m.getTotalVertices() > 0);
    root.computeWorldMatrix(true);
    for (const m of meshes) {
        m.computeWorldMatrix(true);
        m.freezeWorldMatrix();
        m.isPickable = true;
        m.doNotSyncBoundingInfo = true;
    }
    return { root, meshes };
}

export async function loadMap(scene: Scene, base: string): Promise<GameMap> {
    const [{ root, meshes }, recast, navData] = await Promise.all([
        loadMapGeometry(scene, base),
        loadRecast(),
        fetch(base + SNOW_TOWN.nav).then((r) => {
            if (!r.ok) throw new Error(`nav HTTP ${r.status}`);
            return r.arrayBuffer();
        }),
    ]);
    const nav = new RecastJSPlugin(recast);
    nav.buildFromNavmeshData(new Uint8Array(navData));
    nav.setDefaultQueryExtent(new Vector3(1.5, 4, 1.5));
    return { root, meshes, nav, solid: meshes };
}

export function buildNav(recast: unknown, meshes: AbstractMesh[]): RecastJSPlugin {
    const nav = new RecastJSPlugin(recast);
    nav.createNavMesh(meshes as Mesh[], NAV_PARAMS);
    return nav;
}
