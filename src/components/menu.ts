import { iconNode } from "../lib/icons";
import { t } from "../lib/i18n";

// Menú flotante genérico (contextual y de opciones). Un solo menú abierto a la vez.
export type MenuItem =
  | { label: string; onClick: () => void; checked?: boolean; disabled?: boolean; danger?: boolean }
  | { sep: true }
  | { heading: string }
  | { swatches: (string | null)[]; current: string | null | undefined; onPick: (c: string | null) => void }
  | { input: string; onSubmit: (v: string) => void }
  | { icons: (string | null)[]; current: string | undefined; onPick: (i: string | null) => void }
  | { customColor: string; onPick: (c: string) => void };

let open: HTMLElement | null = null;

export function closeMenu() {
  open?.remove();
  open = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("blur", closeMenu);
}

function onOutside(e: MouseEvent) {
  if (open && !open.contains(e.target as Node)) closeMenu();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.stopPropagation(); closeMenu(); }
}

export function showMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "ctx";
  m.role = "menu";

  for (const it of items) {
    if ("sep" in it) { m.append(Object.assign(document.createElement("hr"), {})); continue; }
    if ("heading" in it) { m.append(Object.assign(document.createElement("div"), { className: "ctx-head", textContent: it.heading })); continue; }
    if ("swatches" in it) {
      const row = document.createElement("div");
      row.className = "ctx-swatches";
      for (const c of it.swatches) {
        const b = document.createElement("button");
        b.className = "swatch" + (c === (it.current ?? null) ? " on" : "");
        b.title = c ?? t("Color del perfil");
        if (c) b.style.background = c; else b.textContent = "⊘";
        b.onclick = () => { closeMenu(); it.onPick(c); };
        row.append(b);
      }
      m.append(row);
      continue;
    }
    if ("icons" in it) {
      const row = document.createElement("div");
      row.className = "ctx-icons";
      for (const ic of it.icons) {
        const b = document.createElement("button");
        b.className = "ico" + (ic === (it.current ?? null) ? " on" : "");
        if (ic) b.append(iconNode(ic, 16)); else b.textContent = "⊘";
        b.title = ic ? ic.replace(/^i:/, "") : t("Icono del perfil");
        b.onclick = () => { closeMenu(); it.onPick(ic); };
        row.append(b);
      }
      m.append(row);
      continue;
    }
    if ("customColor" in it) {
      // Matiz con deslizador + hex. Aplica en vivo y no cierra el menú (el <input type=color>
      // nativo abre una ventana aparte y el menú se cerraría por el blur).
      const wrap = document.createElement("div");
      wrap.className = "ctx-custom";
      const lab = document.createElement("span");
      lab.textContent = it.customColor;
      const hue = document.createElement("input");
      hue.type = "range"; hue.min = "0"; hue.max = "360"; hue.className = "hue";
      hue.oninput = () => it.onPick(`hsl(${hue.value} 70% 60%)`);
      const hex = document.createElement("input");
      hex.className = "ctx-input"; hex.placeholder = "#rrggbb";
      hex.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && /^#[0-9a-f]{3,8}$/i.test(hex.value.trim())) it.onPick(hex.value.trim());
      };
      wrap.append(lab, hue, hex);
      m.append(wrap);
      continue;
    }
    if ("input" in it) {
      const inp = document.createElement("input");
      inp.className = "ctx-input";
      inp.placeholder = it.input;
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && inp.value.trim()) { const v = inp.value; closeMenu(); it.onSubmit(v); }
      };
      m.append(inp);
      continue;
    }
    const b = document.createElement("button");
    b.className = "ctx-item" + (it.danger ? " danger" : "");
    b.disabled = !!it.disabled;
    b.role = "menuitem";
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = it.checked ? "✓" : "";
    b.append(tick, it.label);
    b.onclick = () => { closeMenu(); it.onClick(); };
    m.append(b);
  }

  document.body.append(m);
  // Mantener dentro de la ventana.
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  open = m;
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", closeMenu);
}
