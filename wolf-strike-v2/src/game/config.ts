// Gameplay tuning. Wolf stats follow the Wolf Strike wolf roster (v1 values).

export type TeamId = 0 | 1;

export const TEAMS = [
    { id: 0 as TeamId, name: "ÖNCÜLER", model: "human_onculer.glb", color: "#3fa7ff", portrait: "onculer" },
    { id: 1 as TeamId, name: "YAĞMACILAR", model: "human_yagmacilar.glb", color: "#ff4a3d", portrait: "yagmacilar" },
] as const;

export type WolfId = "normal" | "smart" | "crazy" | "ice" | "shadow" | "guardian";

export interface WolfDef {
    id: WolfId;
    name: string;
    role: string;
    file: string;
    portrait: string;
    height: number; // metres (bind pose)
    hp: number;
    claw: number; // base claw damage
    speed: number; // run speed m/s
    jump: number; // jump velocity
    sp: number; // MATCH SP needed to pick it in a match
    rate: number; // animation rate profile
    roar: string;
}

export const WOLVES: Record<WolfId, WolfDef> = {
    normal: { id: "normal", name: "Yaban Kurt", role: "Dengeli", file: "normal_wolf.glb", portrait: "yaban_kurt", height: 2.15, hp: 199, claw: 28, speed: 8.0, jump: 10.5, sp: 0, rate: 1, roar: "wolves/roar/yaban_kurt_kukreme_referans.mp3" },
    smart: { id: "smart", name: "İzci Kurt", role: "Çevik", file: "smart_wolf.glb", portrait: "izci_kurt", height: 1.9, hp: 199, claw: 21, speed: 8.8, jump: 11.5, sp: 300, rate: 1.06, roar: "wolves/roar/yaban_kurt_kukreme_referans.mp3" },
    crazy: { id: "crazy", name: "Çılgın Kurt", role: "Avcı", file: "crazy_wolf.glb", portrait: "cilgin_kurt", height: 2.2, hp: 199, claw: 31, speed: 8.2, jump: 10.5, sp: 300, rate: 1.03, roar: "wolves/roar/cilgin_kurt_uluma_sesi.mp3" },
    ice: { id: "ice", name: "Buz Kurt", role: "Kontrol", file: "ice_wolf.glb", portrait: "buz_kurt", height: 2.2, hp: 299, claw: 29, speed: 7.6, jump: 10, sp: 400, rate: 0.98, roar: "wolves/roar/yaban_kurt_kukreme_referans.mp3" },
    shadow: { id: "shadow", name: "Gölge Kurt", role: "Gizlilik", file: "shadow_wolf.glb", portrait: "golge_kurt", height: 2.15, hp: 299, claw: 28, speed: 7.8, jump: 10.5, sp: 400, rate: 1.02, roar: "wolves/roar/yaban_kurt_kukreme_referans.mp3" },
    guardian: { id: "guardian", name: "Ezici Kurt", role: "Tank", file: "guardian_wolf.glb", portrait: "ezici_kurt", height: 2.5, hp: 799, claw: 43, speed: 6.8, jump: 9, sp: 800, rate: 0.92, roar: "wolves/roar/ezici_kurt_uluma.wav" },
};

export const HUMAN = {
    height: 1.84,
    hp: 100,
    speed: 5.4,
    walk: 2.6,
    jump: 6.6,
    eye: 1.62,
};

export const M4A1 = {
    name: "M4A1",
    damage: 26,
    headMul: 2.2,
    wolfMul: 1, // humans need to focus wolves down
    interval: 0.095,
    mag: 30,
    reserve: 150,
    reload: 2.3,
    range: 90,
    spread: 0.006, // radians, standing still
    moveSpread: 0.03,
    airSpread: 0.07,
    recoilPitch: 0.012,
    recoilYaw: 0.006,
};

export const CLAW = {
    range: 2.6,
    angle: 55 * (Math.PI / 180),
    reach: 1.8,
    comboWindow: 0.55,
    finisherMul: 1.5,
    lungeMul: 1.7,
    lungeSpeed: 13,
    lungeTime: 0.32,
    lungeCooldown: 3.5,
};

export const TRANSFORM = {
    time: 0.55, // seconds of the shape change
    cooldown: 4,
};

export const MATCH = {
    duration: 300,
    killLimit: 40,
    respawn: 4,
    spawnProtect: 2,
    teamSize: 5,
    spKill: 100,
    spAssist: 40,
    gravity: 20,
};

export const SENS = { touch: 0.0052, mouse: 0.0022 };
