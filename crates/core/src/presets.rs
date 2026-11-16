//! Plantillas de perfil para herramientas de línea de comandos habituales (Claude Code, Codex, etc.).
//!
//! Una plantilla + un perfil "anfitrión" (PowerShell, una distro WSL o una shell) dan un perfil nuevo
//! que abre la herramienta ya en marcha. Al salir de la herramienta queda una shell abierta.

use crate::{
    error::{Error, Result},
    launcher::PWSH_OSC7,
    profile::Profile,
};
use serde::Serialize;
use serde_json::Value;

pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    /// Comando que se ejecuta dentro de la shell anfitriona.
    pub command: &'static str,
    /// "i:nombre" = icono SVG de la app; otro texto = emoji.
    pub icon: &'static str,
    pub color: &'static str,
}

pub const PRESETS: &[Preset] = &[
    Preset { id: "claude", name: "Claude Code", command: "claude", icon: "i:bot", color: "#d97757" },
    Preset { id: "claude-continue", name: "Claude Code (continuar)", command: "claude -c", icon: "i:bot", color: "#d97757" },
    Preset { id: "codex", name: "Codex CLI", command: "codex", icon: "i:code", color: "#10a37f" },
    Preset { id: "gemini", name: "Gemini CLI", command: "gemini", icon: "i:star", color: "#4285f4" },
    Preset { id: "opencode", name: "OpenCode", command: "opencode", icon: "i:terminal", color: "#bb9af7" },
    Preset { id: "aider", name: "Aider", command: "aider", icon: "i:wrench", color: "#9ece6a" },
    Preset { id: "lazygit", name: "lazygit", command: "lazygit", icon: "i:branch", color: "#e0af68" },
    Preset { id: "btop", name: "btop", command: "btop", icon: "i:chart", color: "#7dcfff" },
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    pub color: &'static str,
}

pub fn catalog() -> Vec<PresetInfo> {
    PRESETS.iter().map(|p| PresetInfo { id: p.id, name: p.name, icon: p.icon, color: p.color }).collect()
}

pub fn find(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

/// Perfil nuevo = copia del anfitrión + el comando de la plantilla como argumentos.
pub fn profile_for(preset: &Preset, host: &Profile) -> Result<Profile> {
    let list: Vec<String> = match host.kind.as_str() {
        // -Command corre tras cargar $PROFILE; incluye la integración de carpeta (OSC 7).
        "powershell" => vec!["-NoExit".into(), "-Command".into(), format!("{PWSH_OSC7};{}", preset.command)],
        // bash interactivo de login: carga nvm/PATH del usuario, y al salir deja una shell.
        "wsl" => vec!["--exec".into(), "bash".into(), "-lic".into(), format!("{}; exec bash -i", preset.command)],
        "shell" => vec!["-lic".into(), format!("{}; exec \"${{SHELL:-bash}}\" -l", preset.command)],
        k => {
            return Err(Error::InvalidOption {
                profile: host.id.clone(),
                message: format!("las plantillas no funcionan con perfiles de tipo '{k}'"),
            })
        }
    };
    let mut p = host.clone();
    p.id = format!("{}-{}", preset.id, host.id);
    p.name = format!("{} · {}", preset.name, host.name);
    p.icon = Some(preset.icon.to_string());
    p.color = Some(preset.color.to_string());
    p.hidden = false;
    p.auto_detected = false;
    p.options.insert("args".into(), Value::Array(list.into_iter().map(Value::String).collect()));
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<_> = PRESETS.iter().map(|p| p.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), PRESETS.len());
    }

    #[test]
    fn wsl_host_runs_login_shell_with_command() {
        let host = Profile::new("wsl-ubuntu", "Ubuntu", "wsl").with_option("distro", "Ubuntu");
        let p = profile_for(find("claude-continue").unwrap(), &host).unwrap();
        assert_eq!(p.id, "claude-continue-wsl-ubuntu");
        assert_eq!(p.opt_str("distro"), Some("Ubuntu")); // conserva la distro
        let args = p.opt_str_list("args");
        assert_eq!(&args[..3], ["--exec", "bash", "-lic"]);
        assert!(args[3].starts_with("claude -c;"));
    }

    #[test]
    fn powershell_host_keeps_directory_integration() {
        let host = Profile::new("pwsh", "PowerShell", "powershell");
        let p = profile_for(find("claude").unwrap(), &host).unwrap();
        let args = p.opt_str_list("args");
        assert_eq!(&args[..2], ["-NoExit", "-Command"]);
        assert!(args[2].contains("]7;file://") && args[2].ends_with(";claude"));
    }

    #[test]
    fn unsupported_host_errors() {
        let host = Profile::new("c", "CMD", "cmd");
        assert!(profile_for(find("claude").unwrap(), &host).is_err());
    }

    #[test]
    fn launcher_accepts_generated_profile() {
        let host = Profile::new("wsl-ubuntu", "Ubuntu", "wsl").with_option("distro", "Ubuntu");
        let p = profile_for(find("codex").unwrap(), &host).unwrap();
        let spec = crate::launcher::LauncherRegistry::default().build(&p).unwrap();
        assert_eq!(spec.program, "wsl.exe");
        assert!(spec.args.windows(2).any(|w| w == ["--cd", "~"]));
        assert!(spec.args.contains(&"--exec".to_string()));
    }
}
