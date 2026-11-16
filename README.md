# Deckterm

**[Español](#español) · [English](#english)**

---

# Español

Deckterm es una terminal de escritorio multiplataforma (Windows, macOS y Linux) pensada para quien trabaja todo el día con varias shells, proyectos y herramientas de IA en línea de comandos. Cada pestaña abre un **perfil** (PowerShell, CMD, distros de WSL, Git Bash, bash/zsh/fish, SSH o una herramienta como Claude Code), y todas se organizan en una **barra lateral de tarjetas** que muestra, de un vistazo, qué es cada sesión y en qué repositorio y rama está.

> Estado: **v0.1**. Desarrollada y probada en Windows 11. El soporte para macOS y Linux está diseñado, pero todavía no se ha probado. Los instaladores (`npm run tauri build`) aún no se han generado ni verificado.

## Para qué sirve

- Tener abiertas muchas terminales a la vez (por ejemplo, una por proyecto o por agente de IA) sin perderse entre ellas.
- Ver sin cambiar de pestaña la rama de git, el último commit, si hay cambios sin commitear, los commits por subir o bajar y las líneas añadidas o quitadas.
- Abrir con un clic una herramienta como Claude Code, Codex CLI o Gemini CLI dentro de la shell que quieras (PowerShell o una distro WSL).
- Cerrar la aplicación y volver a abrirla con las mismas pestañas, nombres, colores y grupos.

## Lo que queremos lograr

1. **Una terminal ligera.** Que arranque rápido y use poca memoria: webview del sistema en vez de Electron, sin polling y con la GPU activa solo en la pestaña visible.
2. **Contexto a la vista.** Que cada sesión diga qué es y dónde está (carpeta, rama, cambios) sin tener que escribir `pwd` o `git status`.
3. **Organización por proyecto.** Nombres propios, títulos superiores, colores, iconos, grupos plegables, pestañas fijadas y búsqueda.
4. **Pensada para trabajar con agentes de IA.** Plantillas de perfil para las herramientas más usadas, y una base que permita ir sumando integraciones.
5. **Configuración simple y extensible.** Un único archivo JSON editable a mano, y un núcleo en Rust sin dependencias de interfaz, para poder reutilizarlo (otra interfaz, un CLI, un servicio).

## Características

- **Perfiles**: `shell`, `powershell`, `cmd`, `wsl` y `ssh`, con autodetección de las shells instaladas. Cada perfil tiene su carpeta inicial, variables de entorno, tema, fuente, icono y color.
- **Plantillas de perfil**: Claude Code, Claude Code (continuar), Codex CLI, Gemini CLI, OpenCode, Aider, lazygit y btop, sobre cualquier shell anfitriona (PowerShell, WSL, shell).
- **Barra lateral de tarjetas**: nombre, lo que corre en la shell, carpeta, y una fila de git con rama, commit, `●` si hay cambios, `↑`/`↓` y `+N −N`.
- **Personalización por pestaña**: renombrar (doble clic), título superior, color (13 predefinidos, matiz libre o hex), icono (20 SVG o cualquier emoji), grupos, fijar y reordenar. Todo desde el menú contextual (clic derecho o `⋮`).
- **Búsqueda y vista**: buscador de pestañas, densidad compacta o detallada, y qué datos mostrar.
- **Barra superior** sobre el terminal con el nombre, la carpeta, el git de la pestaña activa y acciones rápidas. El botón de la izquierda oculta o muestra la barra lateral.
- **Pantalla de inicio**: un clic en la pestaña activa (o en el logo) oculta el terminal sin cerrar las sesiones. Sin pestañas se ve el logo animado.
- **Prompt abajo** (opcional): con poco contenido, el prompt queda pegado abajo y la salida crece hacia arriba.
- **Restaurar pestañas** al iniciar, en su última carpeta (`state.json`).
- **Idiomas**: español, inglés y portugués (o el idioma del sistema).
- **Fuente**: JetBrains Mono viene incluida; el selector ofrece otras fuentes de programación si están instaladas.

## Instalación

Por ahora no hay instaladores publicados. Hay que compilar desde el código fuente (ver abajo). Al terminar `npm run tauri build`, los instaladores quedan en `target/release/bundle/` (el formato depende del sistema: `.msi`/`.exe` en Windows, `.dmg` en macOS, `.deb`/`.AppImage` en Linux).

En Windows, el instalador descarga el runtime WebView2 si no está presente (ya viene con Windows 11).

## Compilación desde el código fuente

### Requisitos

| Sistema | Qué instalar |
|---|---|
| Todos | [Rust](https://rustup.rs) (rustup) y [Node.js](https://nodejs.org) 18 o superior |
| Windows | WebView2 (incluido en Windows 11) y las *Build Tools* de Visual Studio (carga de trabajo "Desarrollo para el escritorio con C++") |
| Linux | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev` y las herramientas de compilación (`build-essential`). Revisa también la [guía de requisitos de Tauri](https://tauri.app/start/prerequisites/) |
| macOS | Xcode Command Line Tools (`xcode-select --install`) |

### Comandos

```bash
npm install             # dependencias del frontend
npm run tauri dev       # desarrollo: abre la app con recarga en caliente (Vite en el puerto 1420)
npm run tauri build     # versión de producción e instaladores
npm run test:core       # pruebas del núcleo (cargo test -p deckterm-core)
npx tsc --noEmit        # comprobación de tipos del frontend
```

La primera compilación de Rust tarda varios minutos; las siguientes son incrementales.

### Si trabajas desde WSL

El proyecto puede vivir en el disco de Windows, pero las herramientas de compilación deben ser las de Windows (Rust, Node y WebView2 están ahí). Desde WSL puedes lanzarlas por interoperabilidad:

```bash
cd /mnt/c/ruta/al/proyecto
cmd.exe /c "npm run tauri dev"
```

Compilar sobre `/mnt/c` desde Linux es lento. Si puedes, compila desde una terminal de Windows. El paquete `@tauri-apps/cli-win32-x64-msvc` es una dependencia opcional solo para Windows; en otros sistemas se omite.

## Configuración

Todo está en un archivo JSON. Su ruta aparece en el panel de ajustes (⚙).

| Sistema | Carpeta |
|---|---|
| Windows | `%APPDATA%\deckterm\Deckterm\config\` |
| macOS | `~/Library/Application Support/dev.deckterm.Deckterm/` |
| Linux | `~/.config/deckterm/` |

En esa carpeta hay dos archivos: `config.json` (perfiles, temas, apariencia, atajos) y `state.json` (pestañas abiertas, para restaurarlas). La densidad y los datos visibles de la barra lateral se guardan en el almacenamiento local de la ventana.

```json
{
  "defaultProfile": "wsl-ubuntu",
  "appearance": {
    "theme": "deckterm-dark",
    "fontFamily": "'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
    "fontSize": 14,
    "scrollback": 5000,
    "gpu": true,
    "bottomPrompt": true,
    "language": "auto",
    "restoreTabs": true
  },
  "profiles": [
    { "id": "wsl-ubuntu", "name": "Ubuntu", "kind": "wsl", "icon": "🐧",
      "options": { "distro": "Ubuntu-24.04" }, "cwd": "~/proyectos" },
    { "id": "pwsh", "name": "PowerShell", "kind": "powershell", "options": { "edition": "core" },
      "env": { "POWERSHELL_TELEMETRY_OPTOUT": "1" } },
    { "id": "prod", "name": "Servidor prod", "kind": "ssh", "color": "#f7768e",
      "options": { "host": "10.0.0.5", "user": "deploy", "port": 22 } }
  ]
}
```

### Atajos por defecto

`Ctrl+Shift+T` abre una pestaña, `Ctrl+Shift+W` la cierra (las fijadas no se cierran), `Ctrl+Tab` / `Ctrl+Shift+Tab` cambian de pestaña, `Ctrl+,` abre los ajustes, `Ctrl+Shift+C` / `Ctrl+Shift+V` copian y pegan, y `Ctrl+=` / `Ctrl+-` cambian el zoom. Todos se pueden cambiar en `keybindings`.

### Rama y carpeta actual (integración de shell)

Para saber en qué carpeta está cada shell, Deckterm usa la secuencia OSC 7, que la shell emite en cada prompt. Deckterm la activa solo en **PowerShell** (envuelve tu `prompt`, así que convive con oh-my-posh y similares) y en **bash** (por `shell` y por WSL). **fish** la emite por sí misma. En **zsh** y **CMD** no se activa: ahí se usa la carpeta inicial del perfil, y la rama no cambia al hacer `cd`. Se puede desactivar por perfil con `"shellIntegration": false` en `options`.

Mientras corre un programa a pantalla completa (como Claude Code), no hay prompts nuevos y se mantiene la última carpeta conocida. `git` debe estar instalado (en perfiles WSL, dentro de la distro).

## Estructura del proyecto

```
crates/core/         ← toda la lógica, sin interfaz (se prueba y se reutiliza sola)
  config.rs          config.json: perfiles, temas, apariencia, atajos
  profile.rs         modelo de perfil (kind + options libres)
  launcher.rs        perfil → comando. Registro extensible por tipo
  presets.rs         plantillas de perfil (Claude Code, Codex, etc.)
  detect.rs          autodetección: pwsh, powershell, cmd, WSL, Git Bash, /etc/shells
  git.rs             rama, commit y cambios de git
  pty.rs             sesiones PTY con salida agrupada (8 ms / 64 KB)
src-tauri/           capa delgada: comandos IPC hacia el núcleo
src/                 interfaz: pestañas, terminal (xterm.js), ajustes, idiomas
```

Pila: **Rust** (núcleo con `portable-pty`: ConPTY en Windows, openpty en macOS y Linux), **Tauri 2** (ventana con el webview del sistema) y **TypeScript sin framework** con **xterm.js**.

### Agregar un tipo de perfil

```rust
pub struct DockerLauncher;
impl Launcher for DockerLauncher {
    fn kind(&self) -> &'static str { "docker" }
    fn build(&self, p: &Profile) -> Result<CommandSpec> {
        let c = p.opt_str("container").unwrap_or("app");
        Ok(CommandSpec::new("docker").args(["exec", "-it", c, "sh"]))
    }
}
// registry.register(DockerLauncher);
```

No hace falta tocar la interfaz ni migrar la configuración: `options` es JSON libre.

## Cómo se ahorran recursos

- Webview del sistema en vez de Electron.
- La salida del PTY se agrupa cada 8 ms o al juntar 64 KB, para no saturar el IPC.
- Sin polling: los hilos duermen hasta que llega algo.
- WebGL solo en la pestaña visible; el contexto se libera al cambiar de pestaña u ocultar el terminal.
- Scrollback configurable y cursor sin parpadeo por defecto.
- Compilación de producción con `opt-level = "s"`, LTO y `strip`.

## Limitaciones conocidas

- Solo probada en Windows 11. macOS y Linux sin probar.
- No hay paneles divididos ni búsqueda dentro del buffer.
- La barra de título de la ventana es la nativa del sistema.
- Al restaurar, las shells se abren de cero: no se conservan los procesos ni lo que había en pantalla.
- Los textos de las pistas de opciones de cada tipo de perfil no están traducidos.

## Hoja de ruta

- **Próximo**: barra de título propia, paneles divididos, búsqueda en el buffer, importar perfiles de Windows Terminal, paleta de comandos.
- **Después**: temas importables, recarga de la configuración al guardarla, varias ventanas, integración de carpeta para zsh, plantillas para más herramientas.
- **Más adelante**: plugins, sincronización de la configuración, envío de entrada a varias pestañas a la vez.
- **Opcional**: un renderer nativo (wgpu) reutilizando `deckterm-core`, si se necesita el mínimo absoluto de memoria.

## Licencia

[Apache-2.0](LICENSE). Los avisos de software de terceros (incluida la fuente JetBrains Mono, bajo OFL-1.1) están en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

# English

Deckterm is a cross-platform desktop terminal (Windows, macOS and Linux) for people who spend the day juggling several shells, projects and command-line AI tools. Each tab opens a **profile** (PowerShell, CMD, WSL distros, Git Bash, bash/zsh/fish, SSH, or a tool such as Claude Code), and every session is listed in a **sidebar of cards** that shows at a glance what each one is and which repository and branch it is in.

> Status: **v0.1**. Developed and tested on Windows 11. macOS and Linux support is designed but not tested yet. Installers (`npm run tauri build`) have not been generated or verified yet.

## What it is for

- Keeping many terminals open at once (for example, one per project or per AI agent) without getting lost.
- Seeing, without switching tabs, the git branch, the latest commit, whether there are uncommitted changes, commits to push or pull, and lines added or removed.
- Launching a tool such as Claude Code, Codex CLI or Gemini CLI with one click, inside the shell you choose (PowerShell or a WSL distro).
- Closing the app and reopening it with the same tabs, names, colors and groups.

## What we want to achieve

1. **A lightweight terminal.** Fast startup and low memory use: the system webview instead of Electron, no polling, and GPU rendering only on the visible tab.
2. **Context at a glance.** Every session tells you what it is and where it is (folder, branch, changes) without typing `pwd` or `git status`.
3. **Organization by project.** Custom names, headings, colors, icons, collapsible groups, pinned tabs and search.
4. **Built for working with AI agents.** Profile templates for the most common tools, and a base that makes it easy to add more integrations.
5. **Simple, extensible configuration.** A single JSON file you can edit by hand, and a Rust core with no UI dependencies so it can be reused (another UI, a CLI, a service).

## Features

- **Profiles**: `shell`, `powershell`, `cmd`, `wsl` and `ssh`, with autodetection of installed shells. Each profile has its own starting folder, environment variables, theme, font, icon and color.
- **Profile templates**: Claude Code, Claude Code (continue), Codex CLI, Gemini CLI, OpenCode, Aider, lazygit and btop, on any host shell (PowerShell, WSL, shell).
- **Sidebar of cards**: name, what is running in the shell, folder, and a git row with branch, commit, `●` for changes, `↑`/`↓` and `+N −N`.
- **Per-tab customization**: rename (double-click), heading above the tab, color (13 presets, free hue, or hex), icon (20 SVG icons or any emoji), groups, pin and reorder. All from the context menu (right-click or `⋮`).
- **Search and view**: tab search, compact or detailed density, and choice of which data to show.
- **Top bar** above the terminal with the name, folder, git info of the active tab and quick actions. The button on the left hides or shows the sidebar.
- **Home view**: one click on the active tab (or on the logo) hides the terminal without closing any session. With no tabs you see the animated logo.
- **Prompt at the bottom** (optional): with little content, the prompt sits at the bottom and output grows upward.
- **Restore tabs** on startup, in their last folder (`state.json`).
- **Languages**: Spanish, English and Portuguese (or the system language).
- **Font**: JetBrains Mono is bundled; the selector offers other programming fonts if they are installed.

## Installation

There are no published installers yet, so you need to build from source (see below). When `npm run tauri build` finishes, the installers are in `target/release/bundle/` (the format depends on the system: `.msi`/`.exe` on Windows, `.dmg` on macOS, `.deb`/`.AppImage` on Linux).

On Windows, the installer downloads the WebView2 runtime if it is missing (it ships with Windows 11).

## Building from source

### Requirements

| System | What to install |
|---|---|
| All | [Rust](https://rustup.rs) (rustup) and [Node.js](https://nodejs.org) 18 or later |
| Windows | WebView2 (included in Windows 11) and the Visual Studio *Build Tools* ("Desktop development with C++" workload) |
| Linux | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev` and build tools (`build-essential`). Also see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) |
| macOS | Xcode Command Line Tools (`xcode-select --install`) |

### Commands

```bash
npm install             # frontend dependencies
npm run tauri dev       # development: opens the app with hot reload (Vite on port 1420)
npm run tauri build     # production build and installers
npm run test:core       # core tests (cargo test -p deckterm-core)
npx tsc --noEmit        # frontend type check
```

The first Rust build takes several minutes; later ones are incremental.

### Working from WSL

The project can live on the Windows disk, but the build tools must be the Windows ones (Rust, Node and WebView2 are there). From WSL you can launch them through interop:

```bash
cd /mnt/c/path/to/project
cmd.exe /c "npm run tauri dev"
```

Building on `/mnt/c` from Linux is slow. If you can, build from a Windows terminal. The `@tauri-apps/cli-win32-x64-msvc` package is an optional dependency for Windows only; it is skipped on other systems.

## Configuration

Everything lives in a JSON file. Its path is shown in the settings panel (⚙).

| System | Folder |
|---|---|
| Windows | `%APPDATA%\deckterm\Deckterm\config\` |
| macOS | `~/Library/Application Support/dev.deckterm.Deckterm/` |
| Linux | `~/.config/deckterm/` |

Two files live there: `config.json` (profiles, themes, appearance, shortcuts) and `state.json` (open tabs, used to restore them). The sidebar density and visible data are kept in the window's local storage.

```json
{
  "defaultProfile": "wsl-ubuntu",
  "appearance": {
    "theme": "deckterm-dark",
    "fontFamily": "'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
    "fontSize": 14,
    "scrollback": 5000,
    "gpu": true,
    "bottomPrompt": true,
    "language": "auto",
    "restoreTabs": true
  },
  "profiles": [
    { "id": "wsl-ubuntu", "name": "Ubuntu", "kind": "wsl", "icon": "🐧",
      "options": { "distro": "Ubuntu-24.04" }, "cwd": "~/projects" },
    { "id": "pwsh", "name": "PowerShell", "kind": "powershell", "options": { "edition": "core" },
      "env": { "POWERSHELL_TELEMETRY_OPTOUT": "1" } },
    { "id": "prod", "name": "Production server", "kind": "ssh", "color": "#f7768e",
      "options": { "host": "10.0.0.5", "user": "deploy", "port": 22 } }
  ]
}
```

### Default shortcuts

`Ctrl+Shift+T` opens a tab, `Ctrl+Shift+W` closes it (pinned tabs are not closed), `Ctrl+Tab` / `Ctrl+Shift+Tab` switch tabs, `Ctrl+,` opens settings, `Ctrl+Shift+C` / `Ctrl+Shift+V` copy and paste, and `Ctrl+=` / `Ctrl+-` change the zoom. All of them can be changed under `keybindings`.

### Branch and current folder (shell integration)

To know which folder each shell is in, Deckterm uses the OSC 7 escape sequence, which the shell emits at every prompt. Deckterm enables it only for **PowerShell** (it wraps your existing `prompt`, so it coexists with oh-my-posh and similar) and **bash** (both `shell` and WSL profiles). **fish** emits it by itself. For **zsh** and **CMD** it is not enabled: the profile's starting folder is used and the branch does not follow `cd`. You can turn it off per profile with `"shellIntegration": false` in `options`.

While a full-screen program (such as Claude Code) is running there are no new prompts, so the last known folder is kept. `git` must be installed (inside the distro for WSL profiles).

## Project structure

```
crates/core/         ← all the logic, no UI (testable and reusable on its own)
  config.rs          config.json: profiles, themes, appearance, shortcuts
  profile.rs         profile model (kind + free-form options)
  launcher.rs        profile → command. Extensible registry by kind
  presets.rs         profile templates (Claude Code, Codex, etc.)
  detect.rs          autodetection: pwsh, powershell, cmd, WSL, Git Bash, /etc/shells
  git.rs             git branch, commit and changes
  pty.rs             PTY sessions with batched output (8 ms / 64 KB)
src-tauri/           thin layer: IPC commands to the core
src/                 UI: tabs, terminal (xterm.js), settings, languages
```

Stack: **Rust** (core with `portable-pty`: ConPTY on Windows, openpty on macOS and Linux), **Tauri 2** (window using the system webview) and **framework-free TypeScript** with **xterm.js**.

### Adding a profile kind

```rust
pub struct DockerLauncher;
impl Launcher for DockerLauncher {
    fn kind(&self) -> &'static str { "docker" }
    fn build(&self, p: &Profile) -> Result<CommandSpec> {
        let c = p.opt_str("container").unwrap_or("app");
        Ok(CommandSpec::new("docker").args(["exec", "-it", c, "sh"]))
    }
}
// registry.register(DockerLauncher);
```

There is no need to touch the UI or migrate the configuration: `options` is free-form JSON.

## How resources are saved

- System webview instead of Electron.
- PTY output is batched every 8 ms or at 64 KB, so IPC is not flooded.
- No polling: threads sleep until something arrives.
- WebGL only on the visible tab; the context is released when switching tabs or hiding the terminal.
- Configurable scrollback and a non-blinking cursor by default.
- Release builds use `opt-level = "s"`, LTO and `strip`.

## Known limitations

- Tested on Windows 11 only. macOS and Linux are untested.
- No split panes and no search within the buffer.
- The window title bar is the native system one.
- On restore, shells start from scratch: processes and on-screen content are not preserved.
- The per-kind option hints in settings are not translated.

## Roadmap

- **Next**: custom title bar, split panes, buffer search, importing Windows Terminal profiles, command palette.
- **Later**: importable themes, config reload on save, multiple windows, folder integration for zsh, templates for more tools.
- **Further out**: plugins, config sync, broadcasting input to several tabs.
- **Optional**: a native renderer (wgpu) reusing `deckterm-core`, if the absolute minimum memory is needed.

## License

[Apache-2.0](LICENSE). Third-party notices (including the JetBrains Mono font, under OFL-1.1) are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
