// Una pestaña = un xterm.js + una sesión PTY en Rust.
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import { t } from "./i18n";
import { api, resolveAppearance, type AppConfig, type GitInfo, type Profile } from "./api";

const decoder = (b64: string) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export class TermSession {
  readonly el = document.createElement("div");
  readonly term: Terminal;
  private fit = new FitAddon();
  private webgl: WebglAddon | null = null;
  private sessionId: string | null = null;
  private resizeTimer = 0;
  private ro: ResizeObserver;
  private useGpu: boolean;
  title: string;
  /** Nombre puesto a mano (doble clic en la pestaña). Gana sobre `title`. */
  customTitle?: string;
  /** Título superior: texto suelto sobre la tarjeta (no es un grupo: sin plegar ni contador). */
  heading?: string;
  /** Título propio (segunda línea de la tarjeta). Si no hay, se muestra lo que corre o la carpeta. */
  customSubtitle?: string;
  /** Color puesto a mano para la pestaña (si no, el del perfil). */
  customColor?: string;
  /** Icono puesto a mano (emoji). */
  customIcon?: string;
  /** Fijada: va arriba y no se cierra por accidente. */
  pinned = false;
  /** Grupo de la barra lateral. */
  group?: string;
  /** Carpeta actual informada por la shell (OSC 7). */
  cwd?: string;
  git: GitInfo | null = null;
  exited = false;
  private gitTimer = 0;
  private gitBusy = false;
  private bottomAnchor: boolean;
  private shiftRaf = 0;

  constructor(
    readonly profile: Profile,
    cfg: AppConfig,
    private hooks: { onTitle: (t: string) => void; onInfo: () => void; onExit: (code: number | null) => void; onKey: (e: KeyboardEvent) => boolean },
  ) {
    const ap = resolveAppearance(cfg, profile);
    this.useGpu = ap.gpu;
    this.bottomAnchor = ap.bottomPrompt;
    this.title = profile.name;
    this.el.className = "term";
    this.el.style.opacity = String(ap.opacity);

    this.term = new Terminal({
      fontFamily: ap.fontFamily,
      fontSize: ap.fontSize,
      cursorStyle: ap.cursorStyle,
      cursorBlink: ap.cursorBlink,
      scrollback: ap.scrollback,
      theme: (cfg.themes[ap.theme] ?? {}) as ITheme,
      allowProposedApi: true,
      macOptionIsMeta: true,
      windowsPty: navigator.userAgent.includes("Windows") ? { backend: "conpty" } : undefined,
    });
    this.term.loadAddon(this.fit);
    this.term.attachCustomKeyEventHandler((e) => this.hooks.onKey(e));
    this.term.onTitleChange((t) => { this.title = t || profile.name; this.hooks.onTitle(this.title); });
    // Prompt abajo: recalcula el desplazamiento visual cuando cambia el contenido.
    this.term.onWriteParsed(() => this.updateShift());
    this.term.onScroll(() => this.updateShift());
    this.term.buffer.onBufferChange(() => this.updateShift());
    // OSC 7: la shell informa su carpeta actual en cada prompt -> refrescamos git.
    this.term.parser.registerOscHandler(7, (data) => { this.setCwd(data); return true; });
    this.term.onData((d) => this.sessionId && api.write(this.sessionId, d));
    this.term.onBinary((d) => this.sessionId && api.writeBinary(this.sessionId, d));
    this.term.onResize(({ cols, rows }) => {
      this.updateShift();
      // Debounce: no saturar el PTY mientras se arrastra la ventana.
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.sessionId && api.resize(this.sessionId, cols, rows), 50);
    });

    // Sólo reajustar cuando la pestaña es visible (offsetParent != null).
    this.ro = new ResizeObserver(() => { if (this.el.offsetParent) this.fit.fit(); });
  }

  /** Nombre de la pestaña: el puesto a mano o el del perfil. */
  get name() { return this.customTitle || this.profile.name; }
  /**
   * Prompt anclado abajo: mientras el contenido cabe en pantalla (buffer normal, sin scroll),
   * se baja visualmente la pantalla para que la última línea usada quede al fondo.
   * Es sólo CSS sobre .xterm-screen: el PTY y el buffer no cambian, así que no afecta a la shell.
   */
  private updateShift() {
    cancelAnimationFrame(this.shiftRaf);
    this.shiftRaf = requestAnimationFrame(() => {
      const screen = this.el.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return;
      const b = this.term.buffer.active;
      let off = 0;
      if (this.bottomAnchor && b.type === "normal" && b.baseY === 0 && this.term.rows > 0) {
        let used = b.cursorY + 1;
        for (let y = this.term.rows - 1; y >= used; y--) {
          if (b.getLine(y)?.translateToString(true).trim()) { used = y + 1; break; }
        }
        off = Math.max(0, (this.term.rows - used) * (screen.clientHeight / this.term.rows));
      }
      screen.style.transform = off ? `translateY(${off}px)` : "";
    });
  }

  get displayTitle() { return this.customTitle || this.title; }

  private setCwd(uri: string) {
    const m = uri.match(/^file:\/\/[^/]*(\/.*)$/);
    if (!m) return;
    let path = m[1];
    try { path = decodeURIComponent(path); } catch { /* ruta sin codificar: se usa tal cual */ }
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1); // /C:/x -> C:/x
    this.cwd = path;
    this.scheduleGit();
    this.hooks.onInfo();
  }

  /** Debounce: cada prompt emite OSC 7, pero git sólo se consulta cuando se calma. */
  scheduleGit(delay = 400) {
    clearTimeout(this.gitTimer);
    this.gitTimer = window.setTimeout(() => this.refreshGit(), delay);
  }

  private async refreshGit() {
    if (this.gitBusy || this.exited) return;
    this.gitBusy = true;
    try {
      const g = await api.gitInfo(this.profile.id, this.cwd);
      if (JSON.stringify(g) !== JSON.stringify(this.git)) { this.git = g; this.hooks.onInfo(); }
    } catch { /* sin git o sin acceso: se oculta */ }
    this.gitBusy = false;
  }

  /** `cwd`: carpeta inicial al restaurar una pestaña guardada. */
  async start(parent: HTMLElement, cwd?: string) {
    parent.appendChild(this.el);
    this.term.open(this.el);
    this.ro.observe(this.el);
    this.fit.fit();
    this.scheduleGit(100); // estado inicial (carpeta del perfil) hasta que llegue OSC 7
    try {
      this.sessionId = await api.spawn(this.profile.id, this.term.cols, this.term.rows, cwd, (e) => {
        if (e.type === "output") this.term.write(decoder(e.data));
        else {
          this.exited = true;
          this.sessionId = null;
          this.term.write(`\r\n\x1b[2m[${t("proceso terminado")}${e.code != null ? ` ${t("con código {0}", e.code)}` : ""}]\x1b[0m\r\n`);
          this.hooks.onExit(e.code);
        }
      });
    } catch (err) {
      this.exited = true;
      this.term.write(`\x1b[31m${t('No se pudo abrir "{0}":', this.profile.name)}\x1b[0m ${err}\r\n`);
    }
  }

  /** Al mostrar la pestaña: GPU on, ajustar tamaño, foco. */
  async activate() {
    this.el.hidden = false;
    if (this.useGpu && !this.webgl) {
      try {
        // Carga diferida: el addon WebGL sólo se descarga/parsea si se usa.
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const gl = new WebglAddon();
        gl.onContextLoss(() => { gl.dispose(); this.webgl = null; });
        this.term.loadAddon(gl);
        this.webgl = gl;
      } catch { this.useGpu = false; /* cae al renderer DOM */ }
    }
    requestAnimationFrame(() => { this.fit.fit(); this.updateShift(); this.term.focus(); });
  }

  /** Al ocultarla: liberamos el contexto WebGL (memoria de GPU). */
  deactivate() {
    this.el.hidden = true;
    this.webgl?.dispose();
    this.webgl = null;
  }

  zoom(delta: number) {
    this.term.options.fontSize = Math.max(6, (this.term.options.fontSize ?? 14) + delta);
    this.fit.fit();
  }

  dispose() {
    clearTimeout(this.resizeTimer);
    clearTimeout(this.gitTimer);
    cancelAnimationFrame(this.shiftRaf);
    this.ro.disconnect();
    if (this.sessionId) api.kill(this.sessionId);
    this.webgl?.dispose();
    this.term.dispose();
    this.el.remove();
  }
}
