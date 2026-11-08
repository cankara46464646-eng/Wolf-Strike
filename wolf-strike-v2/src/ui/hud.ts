import { TEAMS, WOLVES, type WolfId } from "../game/config";
import type { Actor, Form } from "../game/actor";

export interface HudState {
    hp: number;
    maxHp: number;
    form: Form;
    wolfName: string;
    ammo: number;
    reserve: number;
    reload: number; // 0..1, -1 when not reloading
    lunge: number; // cooldown fraction left
    transform: number; // cooldown fraction left (1 while transforming)
    sp: number;
    score: [number, number];
    time: number;
    limit: number;
    alive: boolean;
    respawn: number;
    protect: boolean;
    spread: number;
}

export interface ScoreRow {
    name: string;
    team: number;
    kills: number;
    deaths: number;
    assists: number;
    sp: number;
    me: boolean;
    bot: boolean;
    alive: boolean;
    form: Form;
}

const h = (tag: string, cls: string, html = ""): HTMLElement => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** In-match HUD (DOM over the canvas). */
export class Hud {
    readonly root: HTMLElement;
    paused = false;
    onScoreTap?: () => void;
    onQuit?: () => void;
    private els: Record<string, HTMLElement> = {};
    private last: Partial<Record<string, string>> = {};
    private msgTimer = 0;
    private hitT = 0;
    private sbPinned = false;
    private deathTimer = 0;
    private base: string;

    constructor(parent: HTMLElement, base: string) {
        this.base = base;
        const r = h("div", "hud");
        r.innerHTML = `
<div class="touch-zone"></div>
<div class="joy"><i></i></div>
<div class="vignette"></div>
<div class="dmg-ring"></div>
<div class="tags"></div>
<div class="top">
  <button class="ibtn pause" aria-label="Duraklat"><span></span><span></span></button>
  <div class="scorebox" role="button" aria-label="Skor tablosu">
    <div class="team t0"><b class="tname">${TEAMS[0].name}</b><b class="tscore s0">0</b></div>
    <div class="clock"><b class="time">5:00</b><small class="limit">40 LEŞ</small></div>
    <div class="team t1"><b class="tscore s1">0</b><b class="tname">${TEAMS[1].name}</b></div>
  </div>
  <div class="feed"></div>
</div>
<div class="xhair"><i class="l"></i><i class="r"></i><i class="u"></i><i class="d"></i><b></b></div>
<div class="hitm"><i></i><i></i><i></i><i></i></div>
<div class="msg"><b></b><small></small></div>
<div class="toasts"></div>
<div class="vitals">
  <div class="formtag"><span class="formname">İNSAN</span><span class="sp">0 SP</span></div>
  <div class="hpline"><b class="hpnum">100</b><div class="hpbar"><i></i></div></div>
  <div class="prot">KORUMA</div>
</div>
<div class="weapon">
  <div class="wname">M4A1</div>
  <div class="ammo"><b class="mag">30</b><span class="res">/ 150</span></div>
  <div class="reloadbar"><i></i></div>
</div>
<div class="btns">
  <button class="b b-fire" data-btn="fire"><span>ATEŞ</span></button>
  <button class="b b-jump" data-btn="jump"><span>ZIPLA</span></button>
  <button class="b b-reload" data-btn="reload"><span>ŞARJÖR</span></button>
  <button class="b b-wolf" data-btn="wolf"><span class="lbl">KURT</span><i class="cd"></i></button>
  <button class="b b-lunge" data-btn="lunge"><span>ATIL</span><i class="cd"></i></button>
</div>
<div class="panel scoreboard" hidden></div>
<div class="panel death" hidden></div>
<div class="panel end" hidden></div>
<div class="panel pausep" hidden>
  <h2>DURAKLATILDI</h2>
  <div class="row"><button class="btn primary resume">DEVAM ET</button><button class="btn quit">MAÇTAN ÇIK</button></div>
  <p class="hint">Bilgisayarda: WASD hareket · Fare nişan · Sol tık ateş · F kurt · E atıl · R şarjör · Boşluk zıpla · TAB skor</p>
</div>`;
        parent.appendChild(r);
        this.root = r;
        const q = (s: string) => r.querySelector<HTMLElement>(s)!;
        for (const k of ["s0", "s1", "time", "limit", "feed", "msg", "toasts", "hpnum", "formname", "sp", "prot", "weapon", "mag", "res", "wname", "xhair", "hitm", "vignette", "dmg-ring", "tags", "scoreboard", "death", "end", "pausep", "vitals"]) this.els[k] = q("." + k);
        this.els.hpbar = q(".hpbar i");
        this.els.reloadbar = q(".reloadbar i");
        this.els.wolfcd = q(".b-wolf .cd");
        this.els.wolflbl = q(".b-wolf .lbl");
        this.els.lungecd = q(".b-lunge .cd");
        this.els.lunge = q(".b-lunge");
        this.els.reload = q(".b-reload");
        this.els.btns = q(".btns");
        q(".pause").addEventListener("click", () => this.togglePause());
        q(".scorebox").addEventListener("click", () => this.onScoreTap?.());
        q(".resume").addEventListener("click", () => this.togglePause(false));
        q(".quit").addEventListener("click", () => {
            this.togglePause(false);
            this.onQuit?.();
        });
        this.els.scoreboard.addEventListener("click", () => {
            this.sbPinned = false;
            this.scoreboard(null);
        });
        this.show(false);
    }

    show(on: boolean): void {
        this.root.style.display = on ? "" : "none";
    }
    setTouch(on: boolean): void {
        this.root.classList.toggle("touch", on);
    }

    togglePause(force?: boolean): void {
        this.paused = force ?? !this.paused;
        this.els.pausep.hidden = !this.paused;
        if (this.paused && document.pointerLockElement) document.exitPointerLock();
    }

    private set(key: string, el: HTMLElement, v: string, prop: "text" | "width" | "class" = "text"): void {
        if (this.last[key] === v) return;
        this.last[key] = v;
        if (prop === "text") el.textContent = v;
        else if (prop === "width") el.style.width = v;
    }

    update(s: HudState): void {
        const e = this.els;
        this.set("s0", e.s0, String(s.score[0]));
        this.set("s1", e.s1, String(s.score[1]));
        const t = Math.ceil(s.time);
        this.set("time", e.time, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`);
        this.set("limit", e.limit, `${s.limit} LEŞ`);
        const hp = Math.max(0, Math.ceil(s.hp));
        this.set("hp", e.hpnum, String(hp));
        const frac = Math.max(0, Math.min(1, s.hp / s.maxHp));
        this.set("hpw", e.hpbar, `${(frac * 100).toFixed(1)}%`, "width");
        this.root.classList.toggle("low", frac < 0.3 && s.alive);
        this.root.classList.toggle("wolf", s.form === "wolf");
        this.root.classList.toggle("dead", !s.alive);
        this.set("form", e.formname, s.form === "wolf" ? s.wolfName.toLocaleUpperCase("tr") : "İNSAN");
        this.set("sp", e.sp, `${s.sp} SP`);
        e.prot.style.display = s.protect ? "" : "none";
        if (s.form === "human") {
            this.set("wname", e.wname, "M4A1");
            this.set("mag", e.mag, String(s.ammo));
            this.set("res", e.res, `/ ${s.reserve}`);
            e.weapon.classList.toggle("empty", s.ammo === 0);
            this.set("rl", e.reloadbar, s.reload >= 0 ? `${(s.reload * 100).toFixed(0)}%` : "0%", "width");
            e.weapon.classList.toggle("reloading", s.reload >= 0);
        } else {
            this.set("wname", e.wname, "PENÇE");
            this.set("mag", e.mag, "∞");
            this.set("res", e.res, "");
            e.weapon.classList.remove("reloading", "empty");
        }
        this.set("wcd", e.wolfcd, `${(Math.max(0, Math.min(1, s.transform)) * 100).toFixed(0)}%`, "width");
        this.set("wl", e.wolflbl, s.form === "wolf" ? "İNSAN" : "KURT");
        this.set("lcd", e.lungecd, `${(Math.max(0, Math.min(1, s.lunge)) * 100).toFixed(0)}%`, "width");
        // crosshair spread
        const gap = Math.round(6 + s.spread * 420);
        if (this.last.gap !== String(gap)) {
            this.last.gap = String(gap);
            e.xhair.style.setProperty("--gap", `${gap}px`);
        }
        if (this.deathTimer > 0) {
            this.deathTimer = Math.max(0, s.respawn);
            const c = this.els.death.querySelector(".count");
            if (c) c.textContent = s.respawn > 0 ? `${Math.ceil(s.respawn)}` : "";
        }
    }

    message(big: string, sub: string, dur: number): void {
        const m = this.els.msg;
        m.querySelector("b")!.textContent = big;
        m.querySelector("small")!.textContent = sub;
        m.classList.remove("on");
        void m.offsetWidth;
        m.classList.add("on");
        clearTimeout(this.msgTimer);
        if (dur > 0) this.msgTimer = window.setTimeout(() => m.classList.remove("on"), dur * 1000);
    }

    hitmarker(head: boolean, kill: boolean): void {
        const m = this.els.hitm;
        m.classList.remove("on");
        void m.offsetWidth;
        m.classList.add("on");
        m.classList.toggle("head", head);
        m.classList.toggle("kill", kill);
        clearTimeout(this.hitT);
        this.hitT = window.setTimeout(() => m.classList.remove("on", "head", "kill"), kill ? 350 : 180);
    }

    damage(angle: number): void {
        const v = this.els.vignette;
        v.classList.remove("on");
        void v.offsetWidth;
        v.classList.add("on");
        const r = this.els["dmg-ring"];
        // angle: 0 = in front; positive = to the left (yaw grows to the left)
        r.style.setProperty("--a", `${(-angle * 180) / Math.PI}deg`);
        r.classList.remove("on");
        void r.offsetWidth;
        r.classList.add("on");
    }

    toast(text: string): void {
        const t = h("div", "toast", esc(text));
        this.els.toasts.appendChild(t);
        setTimeout(() => t.remove(), 1400);
    }

    killfeed(k: string, kc: string, v: string, vc: string, weapon: string, mine: boolean): void {
        const row = h("div", "kf" + (mine ? " mine" : ""), `<b style="color:${kc}">${esc(k)}</b><span class="w">${esc(weapon)}</span><b style="color:${vc}">${esc(v)}</b>`);
        const f = this.els.feed;
        f.prepend(row);
        while (f.children.length > 4) f.lastElementChild!.remove();
        setTimeout(() => row.classList.add("out"), 5000);
        setTimeout(() => row.remove(), 5600);
    }

    tag(name: string, color: string, ally: boolean): HTMLElement {
        const t = h("div", "tag" + (ally ? " ally" : " enemy"), esc(name));
        t.style.setProperty("--c", color);
        t.style.display = "none";
        this.els.tags.appendChild(t);
        return t;
    }

    scoreboard(rows: ScoreRow[] | null, pin = false): void {
        const sb = this.els.scoreboard;
        if (pin) this.sbPinned = !this.sbPinned;
        if (!rows || (!pin && !this.sbPinned && rows === null)) {
            if (!this.sbPinned) sb.hidden = true;
            return;
        }
        if (pin && !this.sbPinned) {
            sb.hidden = true;
            return;
        }
        sb.innerHTML = this.scoreTable(rows) + `<p class="hint">Kapatmak için dokun</p>`;
        sb.hidden = false;
    }

    private scoreTable(rows: ScoreRow[]): string {
        const col = (team: number) => {
            const rs = rows.filter((r) => r.team === team);
            return `<div class="sbcol" style="--c:${TEAMS[team].color}">
<div class="sbhead"><img src="${this.base}ui/portraits/${TEAMS[team].portrait}.jpg" alt=""><b>${TEAMS[team].name}</b></div>
<table><thead><tr><th>OYUNCU</th><th>L</th><th>Ö</th><th>A</th><th>SP</th></tr></thead><tbody>
${rs.map((r) => `<tr class="${r.me ? "me" : ""} ${r.alive ? "" : "dead"}"><td>${esc(r.name)}${r.bot ? ' <em>BOT</em>' : ""}${r.form === "wolf" ? ' <em class="wf">KURT</em>' : ""}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td><td>${r.sp}</td></tr>`).join("")}
</tbody></table></div>`;
        };
        return `<div class="sbwrap">${col(0)}${col(1)}</div>`;
    }

    deathPanel(killer: string | null, me?: Actor, seconds = 0, choose?: (id: WolfId) => void): void {
        const d = this.els.death;
        if (killer === null || !me) {
            d.hidden = true;
            this.deathTimer = 0;
            return;
        }
        const ids = Object.keys(WOLVES) as WolfId[];
        d.innerHTML = `<div class="killedby">ÖLDÜRÜLDÜN <b>${esc(killer)}</b></div>
<div class="respawn">Yeniden doğuş <b class="count">${seconds}</b></div>
<div class="wolfpick"><div class="wp-title">SONRAKİ KURT · MAÇ SP <b>${me.sp}</b></div><div class="wp-row">
${ids
    .map((id) => {
        const w = WOLVES[id];
        const locked = w.sp > me.sp;
        return `<button class="wp ${locked ? "locked" : ""} ${me.wolf.id === id ? "sel" : ""}" data-id="${id}" ${locked ? "disabled" : ""}>
<img src="${this.base}ui/portraits/${w.portrait}.jpg" alt=""><b>${w.name}</b><small>${locked ? `${w.sp} SP` : w.role}</small></button>`;
    })
    .join("")}</div></div>`;
        for (const b of Array.from(d.querySelectorAll<HTMLButtonElement>(".wp"))) {
            b.addEventListener("click", () => choose?.(b.dataset.id as WolfId));
        }
        d.hidden = false;
        this.deathTimer = seconds;
    }

    markWolf(id: WolfId): void {
        for (const b of Array.from(this.els.death.querySelectorAll<HTMLElement>(".wp"))) b.classList.toggle("sel", b.dataset.id === id);
    }

    endPanel(win: boolean | null, score: [number, number], rows: ScoreRow[], done: () => void): void {
        const e = this.els.end;
        this.els.death.hidden = true;
        this.els.scoreboard.hidden = true;
        const title = win === null ? "BERABERE" : win ? "ZAFER" : "YENİLGİ";
        e.innerHTML = `<h1 class="${win ? "win" : win === false ? "lose" : ""}">${title}</h1>
<div class="endscore"><span style="color:${TEAMS[0].color}">${TEAMS[0].name}</span><b>${score[0]} — ${score[1]}</b><span style="color:${TEAMS[1].color}">${TEAMS[1].name}</span></div>
${this.scoreTable(rows)}
<div class="row"><button class="btn primary cont">DEVAM</button></div>`;
        e.querySelector(".cont")!.addEventListener("click", done);
        e.hidden = false;
    }

    reset(): void {
        for (const k of ["scoreboard", "death", "end", "pausep"]) this.els[k].hidden = true;
        this.els.tags.innerHTML = "";
        this.els.feed.innerHTML = "";
        this.paused = false;
        this.sbPinned = false;
        this.last = {};
        this.els.msg.classList.remove("on");
        clearTimeout(this.msgTimer);
    }
}
