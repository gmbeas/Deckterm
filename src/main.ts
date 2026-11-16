import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { api, type AppConfig, type Profile } from "./lib/api";
import { Keymap, type Action } from "./lib/keys";
import { TabManager } from "./lib/tabs";
import { SettingsPanel } from "./components/settings";
import { applyStatic, setLang } from "./lib/i18n";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let config: AppConfig = await api.getConfig();
setLang(config.appearance.language);
applyStatic();
const keymap = new Keymap(config.keybindings);

const settings = new SettingsPanel($("settings"), (c) => {
  config = c;
  keymap.set(c.keybindings);
  setLang(c.appearance.language);
  applyStatic();
  applyChrome();
  buildMenu();
  tabs.refresh();
});

const tabs = new TabManager(
  $("tabs"), $("terminals"), () => config, keymap, (a) => run(a as Action),
  $("tab-search") as HTMLInputElement, $("btn-view"), $("pane-bar"),
);

const visible = () => config.profiles.filter((p) => !p.hidden);
const defaultProfile = (): Profile | undefined =>
  config.profiles.find((p) => p.id === config.defaultProfile) ?? visible()[0];

function openDefault() {
  const p = defaultProfile();
  if (p) tabs.open(p);
  else settings.open(config);
}

function run(a: Action) {
  const t = tabs.current;
  switch (a) {
    case "newTab": return openDefault();
    case "closeTab": return tabs.close();
    case "nextTab": return tabs.cycle(1);
    case "prevTab": return tabs.cycle(-1);
    case "openSettings": return settings.isOpen ? settings.close() : settings.open(config);
    case "copy": { const s = t?.term.getSelection(); if (s) navigator.clipboard.writeText(s); return; }
    case "paste": navigator.clipboard.readText().then((x) => t?.term.paste(x)); return;
    case "zoomIn": return t?.zoom(1);
    case "zoomOut": return t?.zoom(-1);
  }
}

// Colores de la barra = tema global, para que se vea integrado.
function applyChrome() {
  const th = config.themes[config.appearance.theme];
  if (!th) return;
  const r = document.documentElement.style;
  r.setProperty("--bg", th.background);
  r.setProperty("--fg", th.foreground);
  r.setProperty("--accent", th.blue ?? th.cursor);
  r.setProperty("--muted", th.brightBlack ?? "#888");
}

// Menú de perfiles (+ botones de la pantalla vacía)
const menu = $("profile-menu");
const emptyList = $("empty-list");
const label = (p: Profile) => `${p.icon ?? "❯"}  ${p.name}`;
function buildMenu() {
  menu.replaceChildren(...visible().map((p) => {
    const b = document.createElement("button");
    b.role = "menuitem";
    b.textContent = label(p);
    b.onclick = () => { menu.hidden = true; tabs.open(p); };
    return b;
  }));
  emptyList.replaceChildren(...visible().map((p) => {
    const b = document.createElement("button");
    b.textContent = label(p);
    if (p.color) b.style.setProperty("--accent", p.color);
    b.onclick = () => tabs.open(p);
    return b;
  }));
}
// El logo es un interruptor: sin pestañas abre el perfil por defecto; con pestañas
// alterna entre mostrar y ocultar los terminales (las sesiones siguen vivas).
function toggleHome() {
  if (!tabs.count) openDefault();
  else tabs.setHome(!tabs.isHome);
}
$("btn-home").onclick = toggleHome;
document.querySelector<SVGElement>("#empty .logo")!.onclick = toggleHome;
$("btn-new").onclick = openDefault;
$("btn-menu").onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
$("btn-settings").onclick = () => run("openSettings");
document.addEventListener("click", () => (menu.hidden = true));

// Atajos fuera del terminal (p.ej. con el panel de settings abierto)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { menu.hidden = true; if (settings.isOpen) settings.close(); return; }
  const a = keymap.match(e);
  if (a && (settings.isOpen || !tabs.count)) { e.preventDefault(); run(a); }
});

try { if (localStorage.getItem("deckterm.sideCollapsed")) document.body.classList.add("side-collapsed"); } catch { /* sin almacenamiento */ }
applyChrome();
buildMenu();
// La fuente incluida debe estar cargada antes de crear terminales: xterm mide las celdas al iniciar.
await Promise.all([
  document.fonts.load('14px "JetBrains Mono"'),
  document.fonts.load('bold 14px "JetBrains Mono"'),
]).catch(() => {});
// Reabre las pestañas de la sesión anterior; si no hay, se ve el logo hasta que el usuario abra un perfil.
await tabs.restore(config.appearance.restoreTabs ? await api.loadState().catch(() => null) : null, config.profiles);
window.addEventListener("pagehide", () => tabs.flush());
