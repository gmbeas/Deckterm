//! deckterm-core
//!
//! Núcleo independiente de la UI. Todo lo que no es "pintar pantalla" vive aquí,
//! para que pueda reutilizarse desde la app Tauri, un CLI, tests o un futuro daemon.
//!
//! Módulos:
//! - [`config`]   : archivo de configuración (perfiles, temas, apariencia).
//! - [`profile`]  : modelo de un perfil de terminal.
//! - [`launcher`] : convierte un perfil en un comando ejecutable (registro extensible).
//! - [`detect`]   : autodetección de shells instaladas (PowerShell, WSL, bash, zsh...).
//! - [`git`]      : rama/commit/estado de git para mostrar en las pestañas.
//! - [`presets`]  : plantillas de perfil (Claude Code, Codex, etc.).
//! - [`pty`]      : creación y control de pseudo-terminales multiplataforma.

pub mod config;
pub mod detect;
pub mod error;
pub mod git;
pub mod launcher;
pub mod presets;
pub mod profile;
pub mod pty;

pub use config::{AppConfig, Appearance, Theme};
pub use error::{Error, Result};
pub use git::GitInfo;
pub use launcher::{CommandSpec, Launcher, LauncherRegistry};
pub use profile::Profile;
pub use pty::{PtyEvent, PtyManager, PtySize};
