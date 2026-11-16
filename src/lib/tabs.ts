import type { AppConfig, Profile } from "./api";
import { TermSession } from "./terminal";
import type { Keymap } from "./keys";
import { showMenu, type MenuItem } from "../components/menu";
import { ICON_NAMES, iconNode } from "./icons";
import { api, type SavedState, type SavedTab } from "./api";
import { t as tr } from "./i18n";

const base = (p?: string) => (p ? p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p : "");

interface ViewPrefs {
  density: "compact" | "detailed";
  showCwd: boolean;
  showGit: boolean;
  showDiff: boolean;
}
const DEFAULT_VIEW: ViewPrefs = { density: "detailed", showCwd: true, showGit: true, showDiff: true };
const VIEW_KEY = "deckterm.view";
const SWATCHES: (string | null)[] = [
  null, "#f7768e", "#ff9e64", "#e0af68", "#9ece6a", "#73daca", "#7dcfff",
  "#7aa2f7", "#bb9af7", "#f4a6d7", "#c0caf5", "#9aa5ce", "#565f89",
];
const ICONS: (string | null)[] = [null, ...ICON_NAMES];
/** Clave de sección para las fijadas (no choca con ningún nombre de grupo). */
const PIN = "\u0000pin";
const sectionOf = (t: TermSession) => (t.pinned ? PIN : t.group ?? "");

function loadView(): ViewPrefs {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") }; }
  catch { return { ...DEFAULT_VIEW }; }
}

export class TabManager {
  private tabs: TermSession[] = [];
  private active = -1;
  private renaming = false;
  /** Vista de inicio: oculta los terminales (siguen corriendo) y muestra el logo. */
  private home = false;
  private view = loadView();
  private query = "";
  private collapsed = new Set<string>();
  private labels = new Map<TermSession, HTMLElement>();
  private clickTimer = 0;
  private subs = new Map<TermSession, HTMLElement>();
  private groupClickTimer = 0;
  /** Guardado de pestañas: desactivado hasta terminar de restaurar, para no pisar el estado guardado. */
  private persistOn = false;
  private lastSnap = "";
  private persistTimer = 0;

  constructor(
    private tabsEl: HTMLElement,
    private host: HTMLElement,
    private getConfig: () => AppConfig,
    private keymap: Keymap,
    private onAction: (a: string) => void,
    searchEl: HTMLInputElement,
    viewBtn: HTMLElement,
    private barEl: HTMLElement,
  ) {
    searchEl.oninput = () => { this.query = searchEl.value.trim().toLowerCase(); this.render(); };
    viewBtn.onclick = (e) => {
      e.stopPropagation();
      const r = viewBtn.getBoundingClientRect();
      this.viewMenu(r.left, r.bottom + 4);
    };
  }

  /** Fotografía de las pestañas abiertas (lo que se guarda para restaurar). */
  private snapshot(): SavedState {
    return {
      tabs: this.tabs.map((t) => ({
        profileId: t.profile.id,
        cwd: t.cwd,
        name: t.customTitle,
        subtitle: t.customSubtitle,
        heading: t.heading,
        color: t.customColor,
        icon: t.customIcon,
        group: t.group,
        pinned: t.pinned || undefined,
      })),
      active: this.active,
      collapsed: [...this.collapsed],
    };
  }

  /** Guarda con retraso y sólo si cambió algo (render se llama muy seguido por git y títulos). */
  private persist() {
    if (!this.persistOn) return;
    const snap = JSON.stringify(this.snapshot());
    if (snap === this.lastSnap) return;
    this.lastSnap = snap;
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => void api.saveState(JSON.parse(snap)).catch(() => {}), 400);
  }

  /** Guarda ya (al cerrar la ventana). */
  flush() {
    if (!this.persistOn) return;
    clearTimeout(this.persistTimer);
    void api.saveState(this.snapshot()).catch(() => {});
  }

  /** Reabre las pestañas guardadas (si el perfil aún existe) y activa el guardado. */
  async restore(state: SavedState | null, profiles: Profile[]) {
    try {
      for (const saved of state?.tabs ?? []) {
        const p = profiles.find((x) => x.id === saved.profileId);
        if (p) await this.open(p, saved);
      }
      state?.collapsed?.forEach((g) => this.collapsed.add(g));
      if (state && state.active >= 0 && state.active < this.tabs.length) this.select(state.active);
    } finally {
      this.persistOn = true;
      this.render();
    }
  }

  /** Vuelve a pintar (cambio de idioma). */
  refresh() { this.render(); }

  get current() { return this.tabs[this.active]; }
  get count() { return this.tabs.length; }
  get isHome() { return this.home; }

  setHome(v: boolean) {
    v = v && this.tabs.length > 0;
    if (v === this.home) return;
    this.home = v;
    if (v) this.current?.deactivate(); // libera el contexto WebGL mientras está oculto
    else this.current?.activate();
    this.render();
  }

  async open(profile: Profile, saved?: SavedTab) {
    const s: TermSession = new TermSession(profile, this.getConfig(), {
      onTitle: () => this.render(),
      onInfo: () => this.render(),
      onExit: () => this.render(),
      onKey: (e) => {
        const a = this.keymap.match(e);
        if (!a) return true;
        e.preventDefault();
        this.onAction(a);
        return false; // xterm no procesa la tecla
      },
    });
    if (saved) {
      s.cwd = saved.cwd;
      s.customTitle = saved.name;
      s.customSubtitle = saved.subtitle;
      s.heading = saved.heading;
      s.customColor = saved.color;
      s.customIcon = saved.icon;
      s.group = saved.group;
      s.pinned = !!saved.pinned;
    }
    // Oculta las demás antes de montar la nueva: evita ver dos terminales a la vez.
    this.tabs.forEach((t) => (t.el.hidden = true));
    this.tabs.push(s);
    await s.start(this.host, saved?.cwd);
    this.select(this.tabs.length - 1);
  }

  select(i: number) {
    if (i < 0 || i >= this.tabs.length) return;
    if (this.active !== i) this.current?.deactivate();
    this.home = false;
    this.active = i;
    this.tabs.forEach((t, j) => j !== i && (t.el.hidden = true));
    this.current.activate();
    this.current.scheduleGit(0);
    this.render();
  }

  close(i = this.active, force = false) {
    const t = this.tabs[i];
    if (!t || (t.pinned && !force)) return; // fijada: hay que desfijar primero
    t.dispose();
    this.labels.delete(t);
    this.tabs.splice(i, 1);
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1;
    else if (i < this.active) this.active--;
    if (this.tabs.length) this.select(Math.max(0, this.active));
    else { this.active = -1; this.home = false; this.render(); }
  }

  private closeMany(list: TermSession[]) {
    for (const t of list) if (!t.pinned) this.close(this.tabs.indexOf(t));
  }

  /** Orden visual: fijadas, luego sin grupo, luego cada grupo (por primera aparición). */
  private order(): TermSession[] {
    const sections = new Map<string, TermSession[]>([[PIN, []], ["", []]]);
    for (const t of this.tabs) {
      const k = sectionOf(t);
      if (!sections.has(k)) sections.set(k, []);
      sections.get(k)!.push(t);
    }
    return [...sections.values()].flat();
  }

  cycle(dir: 1 | -1) {
    const o = this.order();
    if (!o.length) return;
    const k = o.indexOf(this.current);
    this.select(this.tabs.indexOf(o[(k + dir + o.length) % o.length]));
  }

  // ---------------------------------------------------------------- acciones de pestaña
  /** Edición en línea del nombre o del título propio. Vacío = vuelve al valor automático. */
  private rename(t: TermSession, el?: HTMLElement, field: "name" | "subtitle" | "heading" = "name") {
    const label = el ?? (field === "name" ? this.labels.get(t) : field === "subtitle" ? this.subs.get(t) : undefined);
    if (!label?.isConnected) return;
    this.renaming = true;
    const input = document.createElement("input");
    input.className = "rename" + (field === "subtitle" ? " mono" : field === "heading" ? " heading" : "");
    input.value = field === "name" ? t.name : field === "subtitle" ? t.customSubtitle ?? "" : t.heading ?? "";
    if (field !== "name") input.placeholder = field === "heading" ? tr("Título superior…") : tr("Título…");
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) {
        const v = input.value.trim() || undefined;
        if (field === "name") t.customTitle = v;
        else if (field === "subtitle") t.customSubtitle = v;
        else t.heading = v;
      }
      this.renaming = false;
      this.render();
      t.term.focus();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    };
    input.onblur = () => finish(true);
    input.onclick = (e) => e.stopPropagation();
    label.replaceWith(input);
    input.focus();
    input.select();
  }

  private setGroup(t: TermSession, g?: string) {
    t.group = g?.trim() || undefined;
    this.render();
  }

  /** Sube/baja dentro del mismo grupo intercambiando posición con su vecino. */
  private move(t: TermSession, dir: -1 | 1) {
    const i = this.tabs.indexOf(t);
    for (let j = i + dir; j >= 0 && j < this.tabs.length; j += dir) {
      if (sectionOf(this.tabs[j]) === sectionOf(t)) {
        const act = this.current;
        [this.tabs[i], this.tabs[j]] = [this.tabs[j], this.tabs[i]];
        this.active = this.tabs.indexOf(act);
        break;
      }
    }
    this.render();
  }

  private tabMenu(t: TermSession, x: number, y: number) {
    const o = this.order();
    const pos = o.indexOf(t);
    const groups = [...new Set(this.tabs.map((s) => s.group).filter((g): g is string => !!g))];
    const items: MenuItem[] = [
      { label: t.pinned ? tr("Desfijar pestaña") : tr("Fijar pestaña"), onClick: () => { t.pinned = !t.pinned; this.render(); } },
      { sep: true },
      { label: tr("Renombrar pestaña"), onClick: () => this.rename(t) },
      { input: t.heading ? tr("Título superior: {0}", t.heading) : tr("Título superior (sobre la pestaña)…"), onSubmit: (v) => { t.heading = v.trim() || undefined; this.render(); } },
      { label: tr("Quitar título superior"), disabled: !t.heading, onClick: () => { t.heading = undefined; this.render(); } },
      { label: tr("Restablecer nombre y título"), disabled: !t.customTitle && !t.customSubtitle,
        onClick: () => { t.customTitle = undefined; t.customSubtitle = undefined; this.render(); } },
      { sep: true },
      { label: tr("Copiar título"), onClick: () => void navigator.clipboard.writeText(t.displayTitle) },
      { label: tr("Copiar carpeta actual"), disabled: !t.cwd, onClick: () => void navigator.clipboard.writeText(t.cwd ?? "") },
      { sep: true },
      { heading: tr("Grupo") },
      { label: tr("Sin grupo"), checked: !t.group, onClick: () => this.setGroup(t) },
      ...groups.map((g): MenuItem => ({ label: g, checked: t.group === g, onClick: () => this.setGroup(t, g) })),
      { input: tr("Nuevo grupo…"), onSubmit: (v) => this.setGroup(t, v) },
      { sep: true },
      { label: tr("Subir"), disabled: pos <= 0, onClick: () => this.move(t, -1) },
      { label: tr("Bajar"), disabled: pos >= o.length - 1, onClick: () => this.move(t, 1) },
      { sep: true },
      { label: tr("Cerrar pestaña"), disabled: t.pinned, onClick: () => this.close(this.tabs.indexOf(t)) },
      { label: tr("Cerrar las demás"), disabled: this.tabs.length < 2, onClick: () => this.closeMany(this.tabs.filter((s) => s !== t)) },
      { label: tr("Cerrar las de abajo"), disabled: pos >= o.length - 1, onClick: () => this.closeMany(o.slice(pos + 1)) },
      { sep: true },
      { heading: tr("Color") },
      { swatches: SWATCHES, current: t.customColor, onPick: (c: string | null) => { t.customColor = c ?? undefined; this.render(); } },
      { customColor: tr("Personalizado"), onPick: (c: string) => { t.customColor = c; this.render(); } },
      { sep: true },
      { heading: tr("Icono") },
      { icons: ICONS, current: t.customIcon, onPick: (ic: string | null) => { t.customIcon = ic ?? undefined; this.render(); } },
      { input: tr("Otro icono / emoji…"), onSubmit: (v) => { t.customIcon = [...v.trim()].slice(0, 2).join("") || undefined; this.render(); } },
    ];
    showMenu(x, y, items);
  }

  private viewMenu(x: number, y: number) {
    const set = (patch: Partial<ViewPrefs>) => {
      this.view = { ...this.view, ...patch };
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(this.view)); } catch { /* sin almacenamiento */ }
      this.render();
    };
    const v = this.view;
    showMenu(x, y, [
      { heading: tr("Densidad") },
      { label: tr("Compacta"), checked: v.density === "compact", onClick: () => set({ density: "compact" }) },
      { label: tr("Detallada"), checked: v.density === "detailed", onClick: () => set({ density: "detailed" }) },
      { sep: true },
      { heading: tr("Mostrar") },
      { label: tr("Carpeta actual"), checked: v.showCwd, onClick: () => set({ showCwd: !v.showCwd }) },
      { label: tr("Rama y commit"), checked: v.showGit, onClick: () => set({ showGit: !v.showGit }) },
      { label: tr("Cambios (+/−)"), checked: v.showDiff, onClick: () => set({ showDiff: !v.showDiff }) },
    ]);
  }

  // ---------------------------------------------------------------- render
  private matches(t: TermSession) {
    if (!this.query) return true;
    const hay = [t.name, t.heading, t.customSubtitle, t.title, t.profile.name, t.cwd, t.git?.branch, t.group].filter(Boolean).join("\n").toLowerCase();
    return hay.includes(this.query);
  }

  /** Título superior de una pestaña: etiqueta suelta encima de la tarjeta. */
  private headingEl(t: TermSession): HTMLElement {
    const h = document.createElement("div");
    h.className = "t-heading";
    h.textContent = t.heading ?? "";
    h.title = tr("Doble clic para editar");
    h.ondblclick = () => this.rename(t, h, "heading");
    h.oncontextmenu = (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: tr("Editar título superior"), onClick: () => this.rename(t, h, "heading") },
        { label: tr("Quitar título superior"), onClick: () => { t.heading = undefined; this.render(); } },
      ]);
    };
    return h;
  }

  /** Encabezado de sección: clic = plegar, doble clic = renombrar, clic derecho / ⋮ = menú. */
  private groupHeader(k: string): HTMLElement {
    const isPin = k === PIN;
    const h = document.createElement("div");
    h.className = "t-group" + (this.collapsed.has(k) ? " collapsed" : "");
    const name = document.createElement("span");
    name.className = "t-group-name";
    name.textContent = isPin ? tr("Fijadas") : k;
    const n = this.tabs.filter((t) => sectionOf(t) === k).length;
    const count = document.createElement("span");
    count.className = "t-group-count";
    count.textContent = String(n);
    h.append(name, count);

    const toggle = () => {
      if (!this.collapsed.delete(k)) this.collapsed.add(k);
      this.render();
    };
    h.onclick = () => {
      clearTimeout(this.groupClickTimer);
      this.groupClickTimer = window.setTimeout(toggle, 220); // retardo: no chocar con el doble clic
    };
    if (!isPin) {
      name.title = tr("Doble clic para renombrar el grupo");
      h.ondblclick = (e) => { e.stopPropagation(); clearTimeout(this.groupClickTimer); this.renameGroup(k, name); };
      h.oncontextmenu = (e) => { e.preventDefault(); this.groupMenu(k, name, e.clientX, e.clientY); };
      const more = document.createElement("button");
      more.className = "t-group-more";
      more.textContent = "⋮";
      more.title = tr("Opciones del grupo");
      more.onclick = (e) => { e.stopPropagation(); clearTimeout(this.groupClickTimer); const r = more.getBoundingClientRect(); this.groupMenu(k, name, r.left, r.bottom + 2); };
      h.append(more);
    }
    return h;
  }

  /** Renombra el grupo para todas sus pestañas. Vacío = se cancela. */
  private renameGroup(k: string, el: HTMLElement) {
    if (!el.isConnected) return;
    this.renaming = true;
    const input = document.createElement("input");
    input.className = "rename group";
    input.value = k;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== k) {
        for (const t of this.tabs) if (t.group === k) t.group = v;
        if (this.collapsed.delete(k)) this.collapsed.add(v);
      }
      this.renaming = false;
      this.render();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    };
    input.onblur = () => finish(true);
    input.onclick = (e) => e.stopPropagation();
    el.replaceWith(input);
    input.focus();
    input.select();
  }

  private groupMenu(k: string, el: HTMLElement, x: number, y: number) {
    const members = this.tabs.filter((t) => t.group === k);
    showMenu(x, y, [
      { label: tr("Renombrar grupo"), onClick: () => this.renameGroup(k, el) },
      { label: this.collapsed.has(k) ? tr("Expandir") : tr("Plegar"), onClick: () => { if (!this.collapsed.delete(k)) this.collapsed.add(k); this.render(); } },
      { sep: true },
      { label: tr("Desagrupar (conserva las pestañas)"), onClick: () => { members.forEach((t) => (t.group = undefined)); this.collapsed.delete(k); this.render(); } },
      { label: tr("Cerrar pestañas del grupo"), danger: true, disabled: members.every((t) => t.pinned), onClick: () => this.closeMany(members) },
    ]);
  }

  /** Lo que corre en la shell; vacío si el título es sólo la ruta del ejecutable. */
  private running(t: TermSession) {
    return t.title !== t.name && t.title !== t.profile.name && !/\.exe\b/i.test(t.title) ? t.title : "";
  }

  /** Fila con rama, commit, estado y cambios. null si no hay repo. */
  private gitRow(t: TermSession, showDiff: boolean): HTMLElement | null {
    const g = t.git;
    if (!g) return null;
    const row = document.createElement("div");
    row.className = "t-git";
    const add = (cls: string, text: string, title?: string) => {
      const s = document.createElement("span");
      s.className = cls;
      s.textContent = text;
      if (title) s.title = title;
      row.append(s);
    };
    add("branch", `⎇ ${g.branch ?? "(detached)"}`, tr("Rama"));
    if (g.commit) add("sha", g.commit, tr("Commit"));
    if (g.dirty) add("dirty", "●", tr("Cambios sin commitear"));
    if (g.ahead) add("ahead", `↑${g.ahead}`, tr("Commits por subir"));
    if (g.behind) add("behind", `↓${g.behind}`, tr("Commits por bajar"));
    if (showDiff) {
      if (g.added) add("plus", `+${g.added}`, tr("Líneas añadidas"));
      if (g.removed) add("minus", `−${g.removed}`, tr("Líneas quitadas"));
    }
    return row;
  }

  /** Barra de título sobre el terminal: nombre, lo que corre, carpeta, git y acciones. */
  private updateBar() {
    const t = this.home ? undefined : this.current;
    const color = t ? t.customColor ?? t.profile.color : undefined;
    this.barEl.style.setProperty("--tc", color ?? "transparent");

    // Botón de la barra lateral (siempre visible, también sin pestañas).
    const toggle = document.createElement("button");
    toggle.className = "pb-toggle";
    toggle.title = tr("Mostrar / ocultar barra lateral");
    toggle.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><line x1="6" y1="2.75" x2="6" y2="13.25"/></svg>';
    toggle.onclick = () => {
      const on = document.body.classList.toggle("side-collapsed");
      try { localStorage.setItem("deckterm.sideCollapsed", on ? "1" : ""); } catch { /* sin almacenamiento */ }
    };
    if (!t) { this.barEl.replaceChildren(toggle); return; }

    const icon = document.createElement("span");
    icon.className = "pb-icon";
    icon.append(iconNode(t.customIcon ?? t.profile.icon ?? "i:terminal", 16));
    const name = document.createElement("span");
    name.className = "pb-name";
    name.textContent = t.name;
    name.title = tr("Doble clic para renombrar");
    name.ondblclick = () => this.rename(t, name);
    const info = document.createElement("span");
    info.className = "pb-info";
    info.textContent = [t.customSubtitle || this.running(t), t.cwd ?? ""].filter(Boolean).join("  ·  ");
    info.title = tr("Doble clic para editar el título");
    info.ondblclick = () => this.rename(t, info, "subtitle");

    const parts: HTMLElement[] = [];
    const git = this.gitRow(t, false);
    if (git) parts.push(git);
    const g = t.git;
    if (g && (g.added || g.removed)) {
      // Resumen de cambios como en la referencia: "± +934 −0".
      const sum = document.createElement("span");
      sum.className = "pb-diff";
      sum.title = tr("Cambios respecto a HEAD");
      sum.innerHTML = `<span>±</span><span class="plus">+${g.added}</span><span class="minus">−${g.removed}</span>`;
      parts.push(sum);
    }

    const actions = document.createElement("div");
    actions.className = "pb-actions";
    const btn = (content: Node | string, title: string, fn: () => void, on = false) => {
      const bt = document.createElement("button");
      bt.append(content);
      bt.title = title;
      bt.classList.toggle("on", on);
      bt.onclick = fn;
      actions.append(bt);
    };
    btn(iconNode("i:pin", 14), t.pinned ? tr("Desfijar") : tr("Fijar"), () => { t.pinned = !t.pinned; this.render(); }, t.pinned);
    btn("✎", tr("Renombrar"), () => this.rename(t, name));
    btn("—", tr("Ocultar terminal"), () => this.setHome(true));

    this.barEl.replaceChildren(toggle, icon, name, info, ...parts, actions);
  }

  private card(t: TermSession): HTMLElement {
    const i = this.tabs.indexOf(t);
    const v = this.view;
    const color = t.customColor ?? t.profile.color;
    const b = document.createElement("div");
    b.className = "tab" + (i === this.active && !this.home ? " active" : "") + (t.exited ? " exited" : "")
      + (v.density === "compact" ? " compact" : "") + (color ? " colored" : "");
    b.role = "tab";
    b.title = [t.name, t.customSubtitle, t.title !== t.name ? t.title : "", t.cwd].filter(Boolean).join("\n");
    if (color) b.style.setProperty("--tc", color);

    // Recuadro con el icono a la izquierda; a la derecha nombre, lo que corre y git.
    const tile = document.createElement("span");
    tile.className = "icon-tile";
    tile.append(iconNode(t.customIcon ?? t.profile.icon ?? "i:terminal", 16));

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = t.name; // el nombre va arriba; el título de la shell, debajo
    label.ondblclick = (e) => { e.stopPropagation(); clearTimeout(this.clickTimer); this.rename(t); };
    this.labels.set(t, label);

    const body = document.createElement("div");
    body.className = "t-body";
    body.append(label);

    if (v.density === "detailed") {
      const sub = document.createElement("div");
      sub.className = "t-sub";
      // Título propio; si no hay: lo que corre en la shell, o la carpeta.
      sub.textContent = t.customSubtitle || this.running(t) || (v.showCwd ? base(t.cwd) : "") || t.profile.name;
      sub.ondblclick = (e) => { e.stopPropagation(); clearTimeout(this.clickTimer); this.rename(t, sub, "subtitle"); };
      this.subs.set(t, sub);
      body.append(sub);
    }
    const row = this.gitRow(t, v.showDiff);
    if (row && v.showGit) body.append(row);

    // Acciones flotantes (sólo al pasar el mouse) y marca de fijada (cuando no hay hover).
    const actions = document.createElement("div");
    actions.className = "t-actions";
    const more = document.createElement("button");
    more.textContent = "⋮";
    more.title = tr("Más opciones");
    more.onclick = (e) => { e.stopPropagation(); const r = more.getBoundingClientRect(); this.tabMenu(t, r.left, r.bottom + 2); };
    actions.append(more);
    if (!t.pinned) {
      const x = document.createElement("button");
      x.textContent = "×";
      x.title = tr("Cerrar");
      x.onclick = (e) => { e.stopPropagation(); this.close(this.tabs.indexOf(t)); };
      actions.append(x);
    } else {
      const unpin = document.createElement("button");
      unpin.classList.add("on");
      unpin.append(iconNode("i:pin", 12));
      unpin.title = tr("Desfijar");
      unpin.onclick = (e) => { e.stopPropagation(); t.pinned = false; this.render(); };
      actions.append(unpin);
    }
    b.append(tile, body, actions);
    if (t.pinned) {
      const mark = document.createElement("span");
      mark.className = "t-pinned";
      mark.append(iconNode("i:pin", 12));
      b.append(mark);
    }

    b.onmousedown = (e) => { if (e.button === 1 && !t.pinned) { e.preventDefault(); this.close(this.tabs.indexOf(t)); } };
    b.oncontextmenu = (e) => { e.preventDefault(); this.tabMenu(t, e.clientX, e.clientY); };
    b.onclick = () => {
      clearTimeout(this.clickTimer);
      if (this.tabs.indexOf(t) === this.active && !this.home) {
        // Clic en la pestaña activa = ocultar terminal. Con retardo para no chocar con el doble clic (renombrar).
        this.clickTimer = window.setTimeout(() => this.setHome(true), 220);
      } else {
        this.select(this.tabs.indexOf(t));
      }
    };
    return b;
  }

  private render() {
    this.persist();
    this.host.classList.toggle("has-tabs", this.tabs.length > 0 && !this.home);
    document.body.classList.toggle("home", this.home);
    if (this.renaming) return; // no destruir el input mientras se escribe
    this.updateBar();
    this.labels.clear();
    this.subs.clear();

    const out: HTMLElement[] = [];
    let section: string | undefined;
    for (const t of this.order()) {
      const k = sectionOf(t);
      if (!this.matches(t)) continue;
      if (k !== section) {
        section = k;
        if (k) {
          const h = this.groupHeader(k);
          out.push(h);
        }
      }
      if (k && this.collapsed.has(k)) continue;
      if (t.heading) out.push(this.headingEl(t));
      out.push(this.card(t));
    }
    this.tabsEl.replaceChildren(...out);
  }
}
