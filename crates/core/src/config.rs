//! Configuración en un único JSON legible y editable a mano:
//!   Windows: %APPDATA%\deckterm\Deckterm\config\config.json
//!   macOS:   ~/Library/Application Support/dev.deckterm.Deckterm/config.json
//!   Linux:   ~/.config/deckterm/config.json

use crate::{detect, error::*, profile::Profile};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};

pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "v1")]
    pub version: u32,
    #[serde(default)]
    pub default_profile: Option<String>,
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    #[serde(default = "default_themes")]
    pub themes: BTreeMap<String, Theme>,
    /// Acción -> atajo. Ej. "newTab": "Ctrl+Shift+T".
    #[serde(default = "default_keybindings")]
    pub keybindings: BTreeMap<String, String>,
}

fn v1() -> u32 { CONFIG_VERSION }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub theme: String,
    pub font_family: String,
    pub font_size: f32,
    pub cursor_style: String, // block | bar | underline
    pub cursor_blink: bool,
    /// Líneas de historial por pestaña. Más = más RAM.
    pub scrollback: u32,
    /// Usar renderer WebGL (GPU). Si falla se cae a canvas/DOM solo.
    pub gpu: bool,
    /// Con poco contenido, el prompt queda pegado abajo y la salida crece hacia arriba.
    #[serde(default = "default_true")]
    pub bottom_prompt: bool,
    /// "auto" (idioma del sistema), "es", "en" o "pt".
    #[serde(default = "default_language")]
    pub language: String,
    /// Reabrir las pestañas de la sesión anterior al iniciar.
    #[serde(default = "default_true")]
    pub restore_tabs: bool,
}

fn default_language() -> String { "auto".into() }

/// Fuente por defecto: JetBrains Mono viene incluida en la app; el resto son respaldos del sistema.
pub const DEFAULT_FONT: &str = "'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace";
/// Fuente por defecto de versiones anteriores: se migra a DEFAULT_FONT si el usuario no la cambió.
const OLD_DEFAULT_FONT: &str = "'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace";

fn default_true() -> bool { true }

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: "deckterm-dark".into(),
            font_family: DEFAULT_FONT.into(),
            font_size: 14.0,
            cursor_style: "block".into(),
            cursor_blink: false, // parpadeo apagado = menos repintados
            scrollback: 5000,
            gpu: true,
            bottom_prompt: true,
            language: default_language(),
            restore_tabs: true,
        }
    }
}

/// Paleta compatible con el ITheme de xterm.js.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection_background: String,
    pub black: String, pub red: String, pub green: String, pub yellow: String,
    pub blue: String, pub magenta: String, pub cyan: String, pub white: String,
    pub bright_black: String, pub bright_red: String, pub bright_green: String, pub bright_yellow: String,
    pub bright_blue: String, pub bright_magenta: String, pub bright_cyan: String, pub bright_white: String,
}

fn theme(c: [&str; 20]) -> Theme {
    let s = |i: usize| c[i].to_string();
    Theme {
        background: s(0), foreground: s(1), cursor: s(2), selection_background: s(3),
        black: s(4), red: s(5), green: s(6), yellow: s(7), blue: s(8), magenta: s(9), cyan: s(10), white: s(11),
        bright_black: s(12), bright_red: s(13), bright_green: s(14), bright_yellow: s(15),
        bright_blue: s(16), bright_magenta: s(17), bright_cyan: s(18), bright_white: s(19),
    }
}

pub fn default_themes() -> BTreeMap<String, Theme> {
    BTreeMap::from([
        ("deckterm-dark".into(), theme([
            "#14161b", "#d6dae3", "#7aa2f7", "#2e3446",
            "#1f2229", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
            "#565f89", "#ff899d", "#b9f27c", "#ffc777", "#8db0ff", "#c7a9ff", "#a4daff", "#e6ebff",
        ])),
        ("deckterm-light".into(), theme([
            "#fafaf8", "#2a2c33", "#3b6fd8", "#d7e0f5",
            "#2a2c33", "#c4314b", "#3d8a3b", "#a26a00", "#3b6fd8", "#8a4fc8", "#1a8a9a", "#c8c9cc",
            "#6b6e78", "#e0455f", "#4ea24b", "#c08400", "#5585e8", "#a066e0", "#24a3b5", "#ffffff",
        ])),
    ])
}

pub fn default_keybindings() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("newTab".into(), "Ctrl+Shift+T".into()),
        ("closeTab".into(), "Ctrl+Shift+W".into()),
        ("nextTab".into(), "Ctrl+Tab".into()),
        ("prevTab".into(), "Ctrl+Shift+Tab".into()),
        ("openSettings".into(), "Ctrl+,".into()),
        ("copy".into(), "Ctrl+Shift+C".into()),
        ("paste".into(), "Ctrl+Shift+V".into()),
        ("zoomIn".into(), "Ctrl+=".into()),
        ("zoomOut".into(), "Ctrl+-".into()),
    ])
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            default_profile: None,
            appearance: Appearance::default(),
            profiles: vec![],
            themes: default_themes(),
            keybindings: default_keybindings(),
        }
    }
}

impl AppConfig {
    /// Si existe una config de la versión anterior (carpeta de TermHub) y aún no hay una nueva,
    /// la copia. No borra nada. Llamar una vez al iniciar.
    pub fn migrate_legacy() {
        let old = directories::ProjectDirs::from("dev", "termhub", "TermHub").map(|d| d.config_dir().to_path_buf());
        if let (Some(old), Some(new)) = (old, Self::default_path().parent().map(Path::to_path_buf)) {
            let _ = migrate_legacy_dir(&old, &new);
        }
    }

    pub fn default_path() -> PathBuf {
        directories::ProjectDirs::from("dev", "deckterm", "Deckterm")
            .map(|d| d.config_dir().join("config.json"))
            .unwrap_or_else(|| PathBuf::from("deckterm-config.json"))
    }

    /// Carga la config; si no existe la crea con los shells detectados.
    pub fn load_or_init(path: &Path) -> Result<Self> {
        if path.exists() {
            let mut cfg: AppConfig = serde_json::from_str(&fs::read_to_string(path)?)?;
            cfg.migrate();
            return Ok(cfg);
        }
        let mut cfg = AppConfig { profiles: detect::detect_profiles(), ..Default::default() };
        cfg.default_profile = cfg.profiles.first().map(|p| p.id.clone());
        cfg.save(path)?;
        Ok(cfg)
    }

    /// Escritura atómica (tmp + rename) para no corromper el archivo.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        fs::rename(tmp, path)?;
        Ok(())
    }

    /// Punto único para migrar configs viejas cuando `version` suba.
    fn migrate(&mut self) {
        // Cambio de nombre TermHub -> Deckterm: los temas por defecto cambian de id.
        for (old, new) in [("termhub-dark", "deckterm-dark"), ("termhub-light", "deckterm-light")] {
            if let Some(t) = self.themes.remove(old) {
                self.themes.entry(new.into()).or_insert(t);
            }
            if self.appearance.theme == old {
                self.appearance.theme = new.into();
            }
            for p in &mut self.profiles {
                if p.appearance.theme.as_deref() == Some(old) {
                    p.appearance.theme = Some(new.into());
                }
            }
        }
        // Completar temas/atajos nuevos sin pisar los del usuario.
        for (k, v) in default_themes() {
            self.themes.entry(k).or_insert(v);
        }
        for (k, v) in default_keybindings() {
            self.keybindings.entry(k).or_insert(v);
        }
        if self.appearance.font_family == OLD_DEFAULT_FONT {
            self.appearance.font_family = DEFAULT_FONT.into();
        }
        self.version = CONFIG_VERSION;
    }

    pub fn profile(&self, id: &str) -> Result<&Profile> {
        self.profiles.iter().find(|p| p.id == id).ok_or_else(|| Error::ProfileNotFound(id.into()))
    }

    /// Agrega perfiles detectados que aún no existan (por id). Devuelve cuántos.
    pub fn merge_detected(&mut self) -> usize {
        let mut added = 0;
        for p in detect::detect_profiles() {
            if !self.profiles.iter().any(|e| e.id == p.id) {
                self.profiles.push(p);
                added += 1;
            }
        }
        added
    }
}

/// Copia config.json y state.json de `old_dir` a `new_dir` si la nueva carpeta aún no tiene config.
/// Devuelve true si copió algo.
pub fn migrate_legacy_dir(old_dir: &Path, new_dir: &Path) -> Result<bool> {
    if new_dir.join("config.json").exists() || !old_dir.join("config.json").exists() {
        return Ok(false);
    }
    fs::create_dir_all(new_dir)?;
    for f in ["config.json", "state.json"] {
        let src = old_dir.join(f);
        if src.exists() {
            fs::copy(&src, new_dir.join(f))?;
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_save_and_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/config.json");
        let a = AppConfig::load_or_init(&path).unwrap();
        assert!(path.exists());
        let b = AppConfig::load_or_init(&path).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn partial_config_gets_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, r#"{"profiles":[{"id":"z","name":"zsh","kind":"shell","options":{"command":"/bin/zsh"}}]}"#).unwrap();
        let c = AppConfig::load_or_init(&path).unwrap();
        assert_eq!(c.profiles.len(), 1);
        assert!(c.themes.contains_key("deckterm-dark"));
        assert_eq!(c.appearance.scrollback, 5000);
    }

    #[test]
    fn old_config_gets_new_defaults_and_font_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        // Config vieja: sin language/restoreTabs y con la fuente por defecto anterior.
        let mut cfg = AppConfig::default();
        cfg.appearance.font_family = OLD_DEFAULT_FONT.into();
        let mut v = serde_json::to_value(&cfg).unwrap();
        let ap = v["appearance"].as_object_mut().unwrap();
        ap.remove("language");
        ap.remove("restoreTabs");
        fs::write(&path, v.to_string()).unwrap();
        let c = AppConfig::load_or_init(&path).unwrap();
        assert_eq!(c.appearance.language, "auto");
        assert!(c.appearance.restore_tabs);
        assert_eq!(c.appearance.font_family, DEFAULT_FONT);
    }

    #[test]
    fn custom_font_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let mut cfg = AppConfig::default();
        cfg.appearance.font_family = "'Fira Code', monospace".into();
        cfg.save(&path).unwrap();
        assert_eq!(AppConfig::load_or_init(&path).unwrap().appearance.font_family, "'Fira Code', monospace");
    }

    #[test]
    fn legacy_theme_ids_are_migrated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, r#"{"appearance":{"theme":"termhub-light","fontFamily":"x","fontSize":14,"cursorStyle":"block","cursorBlink":false,"scrollback":100,"gpu":true},
            "profiles":[{"id":"a","name":"a","kind":"shell","appearance":{"theme":"termhub-dark"}}]}"#).unwrap();
        let c = AppConfig::load_or_init(&path).unwrap();
        assert_eq!(c.appearance.theme, "deckterm-light");
        assert_eq!(c.profiles[0].appearance.theme.as_deref(), Some("deckterm-dark"));
        assert!(c.themes.contains_key("deckterm-dark") && !c.themes.contains_key("termhub-dark"));
    }

    #[test]
    fn legacy_dir_is_copied_once_and_never_overwrites() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join("old"), root.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("config.json"), "{\"v\":1}").unwrap();
        fs::write(old.join("state.json"), "{\"s\":1}").unwrap();
        assert!(migrate_legacy_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("state.json")).unwrap(), "{\"s\":1}");
        fs::write(new.join("config.json"), "{\"v\":2}").unwrap();
        assert!(!migrate_legacy_dir(&old, &new).unwrap()); // ya hay config nueva: no pisar
        assert_eq!(fs::read_to_string(new.join("config.json")).unwrap(), "{\"v\":2}");
    }
}
