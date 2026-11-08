import { Engine } from "@babylonjs/core/Engines/engine";
import "./ui/style.css";
import { Audio } from "./game/audio";
import { Game } from "./game/game";
import { Hud } from "./ui/hud";
import { Menu, loadSettings, type Settings } from "./ui/menu";

/** Shared v1 assets live next to /v2/ in the repo (../assets/). */
const BASE = new URL("../assets/", location.href).href;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui")!;
const settings = loadSettings();
const engine = new Engine(canvas, false, { preserveDrawingBuffer: false, stencil: true, powerPreference: "high-performance", audioEngine: false }, false);
const applyQuality = (s: Settings) => {
    const dpr = window.devicePixelRatio || 1;
    engine.setHardwareScalingLevel(1 / Math.min(dpr, s.quality === "high" ? 2 : 1.35));
};
applyQuality(settings);
const audio = new Audio(BASE);
audio.setVolumes(settings.volume, settings.music);
const hud = new Hud(ui, BASE);
const menu = new Menu(ui, BASE, settings);
let game: Game | null = null;

menu.onSettings = (s) => {
    audio.setVolumes(s.volume, s.music);
    applyQuality(s);
};

const toMenu = () => {
    if (game) {
        game.dispose();
        game = null;
    }
    hud.reset();
    hud.show(false);
    menu.show(true);
    audio.music("music/oyun_m_zi_i.mp3");
};

menu.onPlay = async (s) => {
    if (game) return;
    void audio.ctx.resume();
    tryFullscreen();
    menu.show(false);
    menu.showLoading(true);
    audio.music("music/match_loading.mp3");
    const g = new Game(engine, hud, audio, BASE, { playerName: s.name || "Oyuncu", wolf: "normal", quality: s.quality, sens: s.sens });
    game = g;
    try {
        await g.load((p, label) => menu.progress(p, label));
    } catch (e) {
        console.error(e);
        menu.error("Yüklenemedi: " + (e instanceof Error ? e.message : String(e)));
        setTimeout(() => {
            menu.showLoading(false);
            toMenu();
        }, 2500);
        return;
    }
    menu.showLoading(false);
    hud.onQuit = () => toMenu();
    g.onEnd = () => toMenu();
    g.start();
};

function tryFullscreen(): void {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
        if (!document.fullscreenElement && el.requestFullscreen) void el.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
        else el.webkitRequestFullscreen?.();
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        void o?.lock?.("landscape").catch(() => undefined);
    } catch {
        /* not supported (iPhone Safari) */
    }
}

engine.runRenderLoop(() => {
    if (game) game.scene.render();
});
window.addEventListener("resize", () => engine.resize());
document.addEventListener("visibilitychange", () => {
    if (document.hidden && game && !hud.paused) hud.togglePause(true);
});
menu.show(true);
audio.music("music/oyun_m_zi_i.mp3");
const w = window as unknown as Record<string, unknown>;
w.ws = { get game() { return game; }, engine, hud, menu, audio };
