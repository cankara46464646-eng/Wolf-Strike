import type { Intent } from "./actor";
import { SENS } from "./config";

export type Button = "fire" | "jump" | "wolf" | "reload" | "lunge";

interface Stick {
    id: number;
    cx: number;
    cy: number;
    x: number;
    y: number;
}

/**
 * Local player input: touch (floating joystick on the left, drag-to-look on the right, buttons that also
 * steer the view while held) and keyboard + mouse (pointer lock).
 */
export class Input {
    yaw = 0;
    pitch = 0;
    sensTouch = SENS.touch;
    sensMouse = SENS.mouse;
    enabled = false;
    readonly touch: boolean;
    private keys = new Set<string>();
    private mouseDown = false;
    private mouseRight = false;
    private held = new Set<Button>();
    private stick: Stick | null = null;
    private looks = new Map<number, { x: number; y: number }>();
    private joyBase: HTMLElement | null = null;
    private joyKnob: HTMLElement | null = null;
    onScoreboard?: (show: boolean) => void;
    onPause?: () => void;

    constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
        this.touch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
        window.addEventListener("keydown", (e) => {
            if (!this.enabled) return;
            if (e.code === "Tab") {
                e.preventDefault();
                this.onScoreboard?.(true);
            }
            if (e.code === "Escape" || e.code === "KeyP") this.onPause?.();
            this.keys.add(e.code);
        });
        window.addEventListener("keyup", (e) => {
            if (e.code === "Tab") this.onScoreboard?.(false);
            this.keys.delete(e.code);
        });
        window.addEventListener("blur", () => this.reset());
        // mouse
        canvas.addEventListener("mousedown", (e) => {
            if (!this.enabled || this.touch) return;
            if (document.pointerLockElement !== canvas) {
                void canvas.requestPointerLock?.();
                return;
            }
            if (e.button === 0) this.mouseDown = true;
            if (e.button === 2) this.mouseRight = true;
        });
        window.addEventListener("mouseup", (e) => {
            if (e.button === 0) this.mouseDown = false;
            if (e.button === 2) this.mouseRight = false;
        });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        document.addEventListener("mousemove", (e) => {
            if (!this.enabled || document.pointerLockElement !== canvas) return;
            this.look(e.movementX * this.sensMouse, e.movementY * this.sensMouse);
        });
        // touch on the canvas area
        const zone = ui.querySelector<HTMLElement>(".touch-zone")!;
        this.joyBase = ui.querySelector<HTMLElement>(".joy");
        this.joyKnob = ui.querySelector<HTMLElement>(".joy i");
        zone.addEventListener("pointerdown", (e) => this.zoneDown(e));
        zone.addEventListener("pointermove", (e) => this.zoneMove(e));
        zone.addEventListener("pointerup", (e) => this.zoneUp(e));
        zone.addEventListener("pointercancel", (e) => this.zoneUp(e));
        for (const el of Array.from(ui.querySelectorAll<HTMLElement>("[data-btn]"))) {
            const b = el.dataset.btn as Button;
            el.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.setPointerCapture(e.pointerId);
                this.held.add(b);
                el.classList.add("on");
                this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
            });
            el.addEventListener("pointermove", (e) => {
                const l = this.looks.get(e.pointerId);
                if (!l || (b !== "fire" && b !== "lunge")) return;
                this.look((e.clientX - l.x) * this.sensTouch, (e.clientY - l.y) * this.sensTouch);
                l.x = e.clientX;
                l.y = e.clientY;
            });
            const up = (e: PointerEvent) => {
                this.held.delete(b);
                el.classList.remove("on");
                this.looks.delete(e.pointerId);
            };
            el.addEventListener("pointerup", up);
            el.addEventListener("pointercancel", up);
        }
    }

    reset(): void {
        this.keys.clear();
        this.held.clear();
        this.mouseDown = false;
        this.mouseRight = false;
        this.stick = null;
        this.looks.clear();
        this.showJoy(false);
    }

    private look(dx: number, dy: number): void {
        this.yaw -= dx;
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy));
    }

    addRecoil(p: number, y: number): void {
        this.pitch = Math.min(1.35, this.pitch + p);
        this.yaw += y;
    }

    private zoneDown(e: PointerEvent): void {
        if (!this.enabled) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const left = e.clientX < window.innerWidth * 0.42;
        if (left && !this.stick) {
            this.stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: e.clientX, y: e.clientY };
            this.showJoy(true);
        } else {
            this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
    }
    private zoneMove(e: PointerEvent): void {
        if (this.stick && e.pointerId === this.stick.id) {
            this.stick.x = e.clientX;
            this.stick.y = e.clientY;
            this.showJoy(true);
            return;
        }
        const l = this.looks.get(e.pointerId);
        if (l) {
            this.look((e.clientX - l.x) * this.sensTouch, (e.clientY - l.y) * this.sensTouch);
            l.x = e.clientX;
            l.y = e.clientY;
        }
    }
    private zoneUp(e: PointerEvent): void {
        if (this.stick && e.pointerId === this.stick.id) {
            this.stick = null;
            this.showJoy(false);
        }
        this.looks.delete(e.pointerId);
    }

    private showJoy(on: boolean): void {
        if (!this.joyBase || !this.joyKnob) return;
        if (!on || !this.stick) {
            this.joyBase.classList.remove("on");
            this.joyKnob.style.transform = "translate(-50%,-50%)";
            return;
        }
        const s = this.stick;
        const R = 52;
        let dx = s.x - s.cx, dy = s.y - s.cy;
        const l = Math.hypot(dx, dy);
        if (l > R) {
            // the base follows the thumb so direction changes stay responsive
            s.cx += (dx / l) * (l - R);
            s.cy += (dy / l) * (l - R);
            dx = s.x - s.cx;
            dy = s.y - s.cy;
        }
        this.joyBase.classList.add("on");
        this.joyBase.style.left = `${s.cx}px`;
        this.joyBase.style.top = `${s.cy}px`;
        this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }

    fill(it: Intent): void {
        let mx = 0, mz = 0;
        const k = this.keys;
        if (k.has("KeyW") || k.has("ArrowUp")) mz += 1;
        if (k.has("KeyS") || k.has("ArrowDown")) mz -= 1;
        if (k.has("KeyD") || k.has("ArrowRight")) mx += 1;
        if (k.has("KeyA") || k.has("ArrowLeft")) mx -= 1;
        if (this.stick) {
            const dx = (this.stick.x - this.stick.cx) / 52, dy = (this.stick.y - this.stick.cy) / 52;
            const l = Math.hypot(dx, dy);
            const dead = 0.12;
            if (l > dead) {
                const s = Math.min(1, (l - dead) / (1 - dead)) / l;
                mx = dx * s;
                mz = -dy * s;
            }
        }
        it.moveX = mx;
        it.moveZ = mz;
        it.yaw = this.yaw;
        it.pitch = this.pitch;
        it.fire = this.enabled && (this.mouseDown || this.held.has("fire"));
        it.jump = this.enabled && (k.has("Space") || this.held.has("jump"));
        it.transform = this.enabled && (k.has("KeyF") || k.has("KeyQ") || this.held.has("wolf"));
        it.reload = this.enabled && (k.has("KeyR") || this.held.has("reload"));
        it.lunge = this.enabled && (k.has("KeyE") || this.mouseRight || this.held.has("lunge"));
        it.walk = k.has("ShiftLeft") || k.has("ShiftRight");
    }
}
