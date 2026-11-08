import { TEAMS, WOLVES } from "../game/config";
import { SNOW_TOWN } from "../game/map";

export interface Settings {
    name: string;
    sens: number;
    quality: "low" | "high";
    volume: number;
    music: number;
}

const KEY = "ws2.settings";

export function loadSettings(): Settings {
    const def: Settings = { name: "", sens: 1, quality: "low", volume: 0.9, music: 0.6 };
    try {
        const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
        return { ...def, ...s };
    } catch {
        return def;
    }
}
export function saveSettings(s: Settings): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
        /* private mode */
    }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Main menu + loading screen. */
export class Menu {
    readonly root: HTMLElement;
    private loading: HTMLElement;
    onPlay?: (s: Settings) => void;
    onSettings?: (s: Settings) => void;

    constructor(parent: HTMLElement, private base: string, settings: Settings) {
        const r = document.createElement("div");
        r.className = "menu";
        const standalone = (navigator as unknown as { standalone?: boolean }).standalone || matchMedia("(display-mode: standalone)").matches;
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        r.innerHTML = `
<video class="bgvid" autoplay muted loop playsinline poster="${base}video/login_background_poster.jpg">
  <source src="${base}video/login_background.webm" type="video/webm"><source src="${base}video/login_background.mp4" type="video/mp4">
</video>
<div class="shade"></div>
<header class="mtop">
  <div class="logo"><span>WOLF</span><b>STRIKE</b></div>
  <div class="who"><label>OYUNCU ADI<input class="nick" maxlength="16" placeholder="Takma ad" value="${esc(settings.name)}"></label></div>
</header>
<main class="mmain">
  <section class="playcard">
    <div class="pc-art" style="background-image:url('${base}ui/announcements/wolves.jpg')"></div>
    <div class="pc-body">
      <small>HIZLI MAÇ · BOTLARLA ANTRENMAN</small>
      <h2>TAKIM ÖLÜM MAÇI</h2>
      <p><b>${SNOW_TOWN.name}</b> · 5 v 5 · 40 leş · 5 dakika</p>
      <p class="teams"><span style="--c:${TEAMS[0].color}">${TEAMS[0].name}</span> vs <span style="--c:${TEAMS[1].color}">${TEAMS[1].name}</span></p>
      <button class="btn primary big play">OYNA</button>
    </div>
  </section>
  <section class="side">
    <div class="card wolves">
      <h3>KURTLAR</h3>
      <p class="note">Maç içinde kazanılan <b>MAÇ SP</b> ile ölünce seçilir. Yaban Kurt her zaman açık.</p>
      <div class="wl">${Object.values(WOLVES)
          .map((w) => `<div class="wli"><img src="${base}ui/portraits/${w.portrait}.jpg" alt=""><div><b>${w.name}</b><small>${w.role} · ${w.hp} can${w.sp ? ` · ${w.sp} SP` : ""}</small></div></div>`)
          .join("")}</div>
    </div>
    <div class="card settings">
      <h3>AYARLAR</h3>
      <label>Hassasiyet <input type="range" class="sens" min="0.4" max="2.2" step="0.05" value="${settings.sens}"></label>
      <label>Ses <input type="range" class="vol" min="0" max="1" step="0.05" value="${settings.volume}"></label>
      <label>Müzik <input type="range" class="mus" min="0" max="1" step="0.05" value="${settings.music}"></label>
      <label>Grafik <select class="q"><option value="low">Performans</option><option value="high">Kalite</option></select></label>
    </div>
  </section>
</main>
<footer class="mfoot">
  ${ios && !standalone ? '<span class="tip">Tam ekran için Safari’de <b>Paylaş → Ana Ekrana Ekle</b> ile aç.</span>' : '<span class="tip">Bilgisayarda: tıkla ve fareyle nişan al · WASD · F kurt · E atıl</span>'}
  <a class="credits" href="#" role="button">Lisanslar</a>
</footer>
<div class="creditbox" hidden>
  <h3>LİSANSLAR</h3>
  <p>Harita: ${esc(SNOW_TOWN.credit)}</p>
  <p>Kurt animasyonları: Werewolf Anim Set v1.2 (oyuncu tarafından sağlanan paket).</p>
  <p>Yazı tipi: Barlow Condensed (SIL Open Font License).</p>
  <p>Gezinme: Recast &amp; Detour (zlib) · Motor: Babylon.js (Apache-2.0).</p>
  <button class="btn close">KAPAT</button>
</div>`;
        parent.appendChild(r);
        this.root = r;
        const q = <T extends HTMLElement>(s: string) => r.querySelector<T>(s)!;
        q<HTMLSelectElement>(".q").value = settings.quality;
        const sync = () => {
            settings.name = q<HTMLInputElement>(".nick").value.trim().slice(0, 16);
            settings.sens = +q<HTMLInputElement>(".sens").value;
            settings.volume = +q<HTMLInputElement>(".vol").value;
            settings.music = +q<HTMLInputElement>(".mus").value;
            settings.quality = q<HTMLSelectElement>(".q").value as Settings["quality"];
            saveSettings(settings);
            this.onSettings?.(settings);
        };
        r.addEventListener("input", sync);
        r.addEventListener("change", sync);
        q(".play").addEventListener("click", () => {
            sync();
            this.onPlay?.(settings);
        });
        q(".credits").addEventListener("click", (e) => {
            e.preventDefault();
            q(".creditbox").hidden = false;
        });
        q(".close").addEventListener("click", () => (q(".creditbox").hidden = true));

        const l = document.createElement("div");
        l.className = "loading";
        l.innerHTML = `<div class="lbg" style="background-image:url('${base}ui/login/login_art.jpg')"></div><div class="shade"></div>
<div class="lbox"><small>TAKIM ÖLÜM MAÇI</small><h2>${SNOW_TOWN.name}</h2><div class="bar"><i></i></div><p class="lab">Yükleniyor…</p>
<p class="tip">İpucu: Kurtlar yakın dövüşte çok güçlü — insanken mesafeni koru, kurtken saklanarak yaklaş.</p></div>`;
        l.hidden = true;
        parent.appendChild(l);
        this.loading = l;
    }

    show(on: boolean): void {
        this.root.hidden = !on;
        const v = this.root.querySelector<HTMLVideoElement>(".bgvid");
        if (v) {
            if (on) void v.play().catch(() => undefined);
            else v.pause();
        }
    }

    showLoading(on: boolean): void {
        this.loading.hidden = !on;
        if (on) this.progress(0, "Yükleniyor…");
    }

    progress(p: number, label: string): void {
        this.loading.querySelector<HTMLElement>(".bar i")!.style.width = `${Math.round(p * 100)}%`;
        this.loading.querySelector<HTMLElement>(".lab")!.textContent = label;
    }

    error(msg: string): void {
        this.loading.querySelector<HTMLElement>(".lab")!.textContent = msg;
    }

    get base_(): string {
        return this.base;
    }
}
