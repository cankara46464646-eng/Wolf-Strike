/* WOLF STRIKE — night theme helpers (cosmetic only, never touches game state):
   • server rows: a fill bar under "312 / 500" (read from the row's own text, coloured by its status)
   • room rows: the room's map picture as a wide cut-out on the left (read from the row's own thumbnail) */
(function () {
    "use strict";
    function serverBars(root) {
        var rows = root.querySelectorAll(".as-servers .as-srv-row");
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var box = row.querySelector(".as-srv-players");
            var num = row.querySelector(".as-srv-players-num");
            if (!box || !num) continue;
            var m = /(\d[\d.]*)\s*\/\s*(\d[\d.]*)/.exec(num.textContent || "");
            var pct = m ? Math.max(0, Math.min(100, (parseInt(m[1].replace(/\./g, ""), 10) / Math.max(1, parseInt(m[2].replace(/\./g, ""), 10))) * 100)) : 0;
            var bar = box.querySelector(".rd-fill");
            if (!bar) {
                bar = document.createElement("span");
                bar.className = "rd-fill";
                bar.setAttribute("aria-hidden", "true");
                bar.appendChild(document.createElement("i"));
                box.appendChild(bar);
            }
            var st = row.querySelector(".as-status");
            var color = st ? getComputedStyle(st).color : "";
            var fill = bar.firstChild;
            var w = pct.toFixed(1) + "%";
            if (fill.style.width !== w) fill.style.width = w;
            if (color && fill.style.getPropertyValue("--st") !== color) fill.style.setProperty("--st", color);
        }
    }
    function roomThumbs(root) {
        var rows = root.querySelectorAll(".as-lobby .as-room-row");
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var img = row.querySelector(".as-room-thumb img");
            var src = img && img.getAttribute("src");
            var t = row.querySelector(":scope > .rd-thumb");
            if (!src) continue;
            if (!t) {
                t = document.createElement("span");
                t.className = "rd-thumb";
                t.setAttribute("aria-hidden", "true");
                row.insertBefore(t, row.firstChild);
                row.classList.add("rd-has-thumb");
            }
            var bg = 'url("' + img.src + '")';
            if (t.dataset.src !== src) {
                t.dataset.src = src;
                t.style.backgroundImage = bg;
            }
        }
    }
    var queued = false;
    function run() {
        queued = false;
        var root = document.getElementById("shell-root");
        if (!root) return;
        serverBars(root);
        roomThumbs(root);
    }
    function schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(run);
    }
    function start() {
        var root = document.getElementById("shell-root");
        if (!root) return void setTimeout(start, 300);
        new MutationObserver(schedule).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src", "data-status", "class"] });
        schedule();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
