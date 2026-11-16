// Panel de configuración: perfiles, apariencia global y JSON crudo.
import { api, type AppConfig, type Profile } from "../lib/api";
import { LANGS, t } from "../lib/i18n";
import { showMenu, type MenuItem } from "./menu";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...kids);
  return el;
};

const field = (label: string, input: HTMLElement, hint?: string) =>
  h("label", { className: "field" }, h("span", {}, label), input, ...(hint ? [h("small", {}, hint)] : []));

// Fuentes de programación habituales. Sólo JetBrains Mono viene incluida; las demás se usan si están instaladas.
const FONT_PRESETS: [string, string][] = [
  ["JetBrains Mono", "'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace"],
  ["Cascadia Code", "'Cascadia Code', 'JetBrains Mono', Consolas, monospace"],
  ["Fira Code", "'Fira Code', 'JetBrains Mono', Consolas, monospace"],
  ["Geist Mono", "'Geist Mono', 'JetBrains Mono', Consolas, monospace"],
  ["Source Code Pro", "'Source Code Pro', 'JetBrains Mono', Consolas, monospace"],
  ["Iosevka", "Iosevka, 'JetBrains Mono', Consolas, monospace"],
  ["Hack", "Hack, 'JetBrains Mono', Consolas, monospace"],
  ["JetBrainsMono Nerd Font", "'JetBrainsMono Nerd Font', 'JetBrains Mono', monospace"],
  ["Consolas", "Consolas, 'Courier New', monospace"],
];

const OPTION_HINTS: Record<string, string> = {
  shell: '{ "command": "/bin/zsh", "args": ["-l"] }',
  powershell: '{ "edition": "core" | "desktop", "noLogo": true }',
  cmd: '{ "args": [] }',
  wsl: '{ "distro": "Ubuntu-24.04", "user": "root" }',
  ssh: '{ "host": "servidor", "user": "ana", "port": 22, "identityFile": "~/.ssh/id_ed25519" }',
};

export class SettingsPanel {
  private cfg!: AppConfig;
  private kinds: string[] = [];
  private selected = 0;
  private section: "profiles" | "appearance" | "json" = "profiles";

  constructor(private root: HTMLElement, private onSaved: (c: AppConfig) => void) {}

  get isOpen() { return !this.root.hidden; }

  async open(cfg: AppConfig) {
    this.cfg = structuredClone(cfg);
    if (!this.kinds.length) this.kinds = await api.listKinds();
    this.root.hidden = false;
    this.render();
  }

  close() { this.root.hidden = true; this.root.replaceChildren(); }

  private async save() {
    try {
      await api.saveConfig(this.cfg);
      this.onSaved(structuredClone(this.cfg));
      this.render(); // el idioma pudo cambiar
      this.flash(t("Guardado ✓"));
    } catch (e) { this.flash(t("Error: {0}", String(e)), true); }
  }

  private flash(msg: string, err = false) {
    const s = this.root.querySelector(".status");
    if (s) { s.textContent = msg; s.classList.toggle("error", err); }
  }

  private render() {
    const nav = h("nav", {},
      ...(["profiles", "appearance", "json"] as const).map((s) =>
        h("button", { className: this.section === s ? "on" : "", onclick: () => { this.section = s; this.render(); } },
          { profiles: t("Perfiles"), appearance: t("Apariencia"), json: "JSON" }[s])),
    );
    const body = this.section === "profiles" ? this.profilesView()
      : this.section === "appearance" ? this.appearanceView() : this.jsonView();

    const footer = h("footer", {},
      h("span", { className: "status" }),
      h("button", { onclick: () => this.close() }, t("Cerrar")),
      h("button", { className: "primary", onclick: () => this.save() }, t("Guardar")),
    );
    api.configPath().then((p) => { const s = this.root.querySelector(".path"); if (s) s.textContent = p; });
    this.root.replaceChildren(
      h("div", { className: "panel" }, h("h2", {}, t("Configuración")), h("code", { className: "path" }), nav, body, footer),
    );
  }

  // ---------------------------------------------------------------- perfiles
  private profilesView() {
    const ps = this.cfg.profiles;
    if (this.selected >= ps.length) this.selected = Math.max(0, ps.length - 1);

    const list = h("ul", { className: "plist" },
      ...ps.map((p, i) => h("li", {
        className: (i === this.selected ? "on " : "") + (p.hidden ? "muted" : ""),
        onclick: () => { this.selected = i; this.render(); },
      }, `${p.icon ?? "❯"} ${p.name}`, this.cfg.defaultProfile === p.id ? h("em", {}, " ★") : "")),
    );

    const actions = h("div", { className: "row" },
      h("button", { onclick: () => this.addProfile() }, t("+ Nuevo")),
      h("button", { onclick: (e: Event) => void this.templateMenu(e.currentTarget as HTMLElement) }, t("Desde plantilla…")),
      h("button", { onclick: () => this.duplicate(), disabled: !ps.length }, t("Duplicar")),
      h("button", { onclick: () => this.remove(), disabled: !ps.length }, t("Eliminar")),
      h("button", { onclick: async () => { this.cfg = await api.redetect(); this.render(); this.flash(t("Shells redetectadas")); } }, t("Redetectar shells")),
    );

    const p = ps[this.selected];
    return h("div", { className: "split" }, h("div", {}, list, actions), p ? this.profileForm(p) : h("p", {}, t("Sin perfiles")));
  }

  private profileForm(p: Profile) {
    const text = (val: string | undefined, set: (v: string) => void, ph = "") =>
      h("input", { value: val ?? "", placeholder: ph, oninput: (e: Event) => set((e.target as HTMLInputElement).value) });

    const kind = h("select", { onchange: (e: Event) => { p.kind = (e.target as HTMLSelectElement).value; this.render(); } },
      ...this.kinds.map((k) => h("option", { value: k, selected: k === p.kind }, k)));

    const options = h("textarea", { rows: 4, value: JSON.stringify(p.options ?? {}, null, 2), spellcheck: false,
      onchange: (e: Event) => {
        try { p.options = JSON.parse((e.target as HTMLTextAreaElement).value || "{}"); this.flash(""); }
        catch { this.flash(t("Opciones: JSON inválido"), true); }
      } });

    const env = h("textarea", { rows: 3, spellcheck: false,
      value: Object.entries(p.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"),
      onchange: (e: Event) => {
        p.env = Object.fromEntries((e.target as HTMLTextAreaElement).value.split("\n")
          .map((l) => l.trim()).filter((l) => l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
      } });

    const themes = h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; p.appearance.theme = v || undefined; } },
      h("option", { value: "" }, "(global)"),
      ...Object.keys(this.cfg.themes).map((t) => h("option", { value: t, selected: p.appearance.theme === t }, t)));

    const size = h("input", { type: "number", min: "6", max: "48", value: p.appearance.fontSize?.toString() ?? "", placeholder: "(global)",
      oninput: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value); p.appearance.fontSize = isNaN(v) ? undefined : v; } });

    const check = (checked: boolean, set: (v: boolean) => void) =>
      h("input", { type: "checkbox", checked, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });

    return h("div", { className: "form" },
      field(t("Nombre"), text(p.name, (v) => { p.name = v; })),
      h("div", { className: "row" },
        field(t("Icono"), text(p.icon, (v) => { p.icon = v || undefined; }, "⚡")),
        field(t("Color"), h("input", { type: "color", value: p.color ?? "#7aa2f7", oninput: (e: Event) => { p.color = (e.target as HTMLInputElement).value; } })),
      ),
      field(t("Tipo"), kind),
      field(t("Opciones"), options, OPTION_HINTS[p.kind]),
      field(t("Carpeta inicial"), text(p.cwd, (v) => { p.cwd = v || undefined; }, p.kind === "wsl" ? t("~ (ruta dentro de la distro)") : "~")),
      field(t("Variables de entorno"), env, t("Una por línea: CLAVE=valor")),
      h("div", { className: "row" }, field(t("Tema"), themes), field(t("Tamaño fuente"), size)),
      field(t("Fuente"), text(p.appearance.fontFamily, (v) => { p.appearance.fontFamily = v || undefined; }, "(global)")),
      h("div", { className: "row" },
        field(t("Perfil por defecto"), check(this.cfg.defaultProfile === p.id, (v) => { this.cfg.defaultProfile = v ? p.id : null; })),
        field(t("Oculto en menú"), check(p.hidden, (v) => { p.hidden = v; })),
      ),
    );
  }

  /** Menú de plantillas (Claude Code, Codex…): una sección por shell anfitriona. */
  private async templateMenu(btn: HTMLElement) {
    const hosts = this.cfg.profiles.filter((p) => ["powershell", "wsl", "shell"].includes(p.kind) && !p.hidden);
    if (!hosts.length) { this.flash(t("Sin perfiles"), true); return; }
    const presets = await api.presets();
    const items: MenuItem[] = hosts.flatMap((host, i): MenuItem[] => [
      ...(i ? [{ sep: true } as MenuItem] : []),
      { heading: host.name },
      ...presets.map((pr): MenuItem => ({ label: pr.name, onClick: () => void this.addFromTemplate(pr.id, host) })),
    ]);
    const r = btn.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, items);
  }

  private async addFromTemplate(presetId: string, host: Profile) {
    try {
      const p = await api.presetProfile(presetId, host);
      const base = p.id;
      for (let n = 2; this.cfg.profiles.some((x) => x.id === p.id); n++) p.id = `${base}-${n}`;
      this.cfg.profiles.push(p);
      this.selected = this.cfg.profiles.length - 1;
      this.render();
      this.flash(t("Plantilla agregada — recuerda Guardar"));
    } catch (e) { this.flash(t("Error: {0}", String(e)), true); }
  }

  private addProfile() {
    const id = `perfil-${Date.now().toString(36)}`;
    this.cfg.profiles.push({ id, name: t("Nuevo perfil"), kind: "shell", options: { command: "" }, appearance: {}, hidden: false, autoDetected: false });
    this.selected = this.cfg.profiles.length - 1;
    this.render();
  }

  private duplicate() {
    const src = this.cfg.profiles[this.selected];
    this.cfg.profiles.push({ ...structuredClone(src), id: `${src.id}-copia-${Date.now().toString(36)}`, name: t("{0} (copia)", src.name), autoDetected: false });
    this.selected = this.cfg.profiles.length - 1;
    this.render();
  }

  private remove() {
    const [p] = this.cfg.profiles.splice(this.selected, 1);
    if (p && this.cfg.defaultProfile === p.id) this.cfg.defaultProfile = this.cfg.profiles[0]?.id ?? null;
    this.render();
  }

  private fontField(get: () => string, set: (v: string) => void) {
    const input = h("input", { value: get(), oninput: (e: Event) => set((e.target as HTMLInputElement).value) });
    const sel = h("select", {
      onchange: () => { const v = sel.value; if (v) { set(v); input.value = v; } },
    }, h("option", { value: "" }, t("Otra…")),
      ...FONT_PRESETS.map(([name, stack]) =>
        h("option", { value: stack, selected: get() === stack }, name === "JetBrains Mono" ? `${name} (${t("incluida")})` : name)));
    return h("div", { className: "font-field" }, sel, input);
  }

  // ---------------------------------------------------------------- apariencia
  private appearanceView() {
    const a = this.cfg.appearance;
    const num = (v: number, set: (n: number) => void, min = "0") =>
      h("input", { type: "number", min, value: String(v), oninput: (e: Event) => set(Number((e.target as HTMLInputElement).value)) });
    return h("div", { className: "form" },
      h("div", { className: "row" },
        field(t("Idioma"), h("select", { onchange: (e: Event) => { a.language = (e.target as HTMLSelectElement).value; } },
          ...LANGS.map((l) => h("option", { value: l.id, selected: a.language === l.id }, l.label)))),
        field(t("Restaurar pestañas al iniciar"), h("input", { type: "checkbox", checked: a.restoreTabs, onchange: (e: Event) => { a.restoreTabs = (e.target as HTMLInputElement).checked; } }),
          t("Guarda las pestañas abiertas (nombre, color, grupo, carpeta) y las reabre al iniciar")),
      ),
      field(t("Tema"), h("select", { onchange: (e: Event) => { a.theme = (e.target as HTMLSelectElement).value; } },
        ...Object.keys(this.cfg.themes).map((t) => h("option", { value: t, selected: a.theme === t }, t)))),
      field(t("Fuente"), this.fontField(() => a.fontFamily, (v) => { a.fontFamily = v; }), t("Fuente monoespaciada. Para iconos de prompts (oh-my-posh, starship) usa una Nerd Font.")),
      h("div", { className: "row" },
        field(t("Tamaño"), num(a.fontSize, (n) => { a.fontSize = n; }, "6")),
        field("Cursor", h("select", { onchange: (e: Event) => { a.cursorStyle = (e.target as HTMLSelectElement).value as typeof a.cursorStyle; } },
          ...["block", "bar", "underline"].map((c) => h("option", { value: c, selected: a.cursorStyle === c }, c)))),
      ),
      field(t("Historial (líneas)"), num(a.scrollback, (n) => { a.scrollback = n; }), t("Más líneas = más memoria por pestaña")),
      h("div", { className: "row" },
        field(t("Cursor parpadeante"), h("input", { type: "checkbox", checked: a.cursorBlink, onchange: (e: Event) => { a.cursorBlink = (e.target as HTMLInputElement).checked; } })),
        field(t("Prompt abajo"), h("input", { type: "checkbox", checked: a.bottomPrompt, onchange: (e: Event) => { a.bottomPrompt = (e.target as HTMLInputElement).checked; } }), t("Con poco contenido, el prompt queda abajo y la salida sube")),
        field(t("Aceleración GPU (WebGL)"), h("input", { type: "checkbox", checked: a.gpu, onchange: (e: Event) => { a.gpu = (e.target as HTMLInputElement).checked; } })),
      ),
      h("small", {}, t("Los cambios de apariencia aplican a pestañas nuevas.")),
    );
  }

  // ---------------------------------------------------------------- json
  private jsonView() {
    const ta = h("textarea", { className: "json", spellcheck: false, value: JSON.stringify(this.cfg, null, 2),
      onchange: (e: Event) => {
        try { this.cfg = JSON.parse((e.target as HTMLTextAreaElement).value); this.flash(t("JSON válido — recuerda Guardar")); }
        catch (err) { this.flash(t("JSON inválido: {0}", String(err)), true); }
      } });
    return h("div", { className: "form" }, ta);
  }
}
