//! Launchers: traducen un [`Profile`] a un [`CommandSpec`] ejecutable.
//!
//! Para soportar un tipo nuevo (p.ej. "docker", "nushell", "serial") basta con
//! implementar [`Launcher`] y registrarlo en [`LauncherRegistry`].

use crate::{error::*, profile::Profile};
use std::collections::{BTreeMap, HashMap};

/// Comando final a ejecutar dentro del PTY.
#[derive(Debug, Clone, PartialEq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
}

impl CommandSpec {
    pub fn new(program: impl Into<String>) -> Self {
        Self { program: program.into(), args: vec![], cwd: None, env: BTreeMap::new() }
    }
    pub fn args<I: IntoIterator<Item = S>, S: Into<String>>(mut self, a: I) -> Self {
        self.args.extend(a.into_iter().map(Into::into));
        self
    }
}

pub trait Launcher: Send + Sync {
    /// Identificador usado en `profile.kind`.
    fn kind(&self) -> &'static str;
    fn build(&self, profile: &Profile) -> Result<CommandSpec>;
}

pub struct LauncherRegistry {
    launchers: HashMap<&'static str, Box<dyn Launcher>>,
}

impl Default for LauncherRegistry {
    fn default() -> Self {
        let mut r = Self { launchers: HashMap::new() };
        r.register(ShellLauncher);
        r.register(PowerShellLauncher);
        r.register(CmdLauncher);
        r.register(WslLauncher);
        r.register(SshLauncher);
        r
    }
}

impl LauncherRegistry {
    pub fn register<L: Launcher + 'static>(&mut self, l: L) {
        self.launchers.insert(l.kind(), Box::new(l));
    }

    pub fn kinds(&self) -> Vec<&'static str> {
        let mut k: Vec<_> = self.launchers.keys().copied().collect();
        k.sort();
        k
    }

    /// Construye el comando y aplica lo común a todos los tipos (cwd, env).
    pub fn build(&self, profile: &Profile) -> Result<CommandSpec> {
        let l = self
            .launchers
            .get(profile.kind.as_str())
            .ok_or_else(|| Error::UnknownKind(profile.kind.clone()))?;
        let mut spec = l.build(profile)?;
        if spec.cwd.is_none() {
            spec.cwd = profile.cwd.as_deref().map(expand_home);
        }
        spec.env.extend(profile.env.clone());
        // Integración de shell: bash informa su carpeta con OSC 7 en cada prompt
        // (PROMPT_COMMAND se hereda por entorno). Se desactiva con
        // options.shellIntegration = false, o definiendo PROMPT_COMMAND en env.
        let integrate = profile.opt_bool("shellIntegration").unwrap_or(true);
        if integrate && matches!(profile.kind.as_str(), "shell" | "wsl") {
            spec.env.entry("PROMPT_COMMAND".into()).or_insert_with(|| BASH_OSC7.into());
            if profile.kind == "wsl" {
                // WSL sólo pasa a la distro las variables listadas en WSLENV.
                let cur = spec.env.get("WSLENV").cloned().or_else(|| std::env::var("WSLENV").ok());
                let wslenv = match cur {
                    Some(c) if !c.is_empty() => format!("{c}:PROMPT_COMMAND"),
                    _ => "PROMPT_COMMAND".to_string(),
                };
                spec.env.insert("WSLENV".into(), wslenv);
            }
        }
        spec.env.entry("TERM".into()).or_insert_with(|| "xterm-256color".into());
        spec.env.entry("COLORTERM".into()).or_insert_with(|| "truecolor".into());
        spec.env.insert("TERM_PROGRAM".into(), "Deckterm".into());
        Ok(spec)
    }
}

/// bash: emite la carpeta actual (OSC 7) antes de cada prompt.
const BASH_OSC7: &str = r#"printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD""#;

/// PowerShell: envuelve el `prompt` ya definido por el perfil del usuario (oh-my-posh,
/// etc.) y emite OSC 7 antes de él. Corre tras cargar `$PROFILE`.
pub const PWSH_OSC7: &str = r#"$global:__thp=$function:prompt;function global:prompt{if((Get-Location).Provider.Name -eq 'FileSystem'){[Console]::Write([string][char]27+']7;file://localhost/'+(Get-Location).Path.Replace('\','/')+[char]7)};if($global:__thp){& $global:__thp}else{'PS> '}}"#;

pub fn expand_home(p: &str) -> String {
    if let Some(rest) = p.strip_prefix('~') {
        if let Some(home) = directories::UserDirs::new().map(|u| u.home_dir().to_path_buf()) {
            return format!("{}{}", home.display(), rest);
        }
    }
    p.to_string()
}

fn require<'a>(p: &'a Profile, key: &str) -> Result<&'a str> {
    p.opt_str(key).ok_or_else(|| Error::InvalidOption {
        profile: p.id.clone(),
        message: format!("falta la opción '{key}'"),
    })
}

// ---------------------------------------------------------------- built-ins

/// Shell genérica: { "command": "/bin/zsh", "args": ["-l"] }
pub struct ShellLauncher;
impl Launcher for ShellLauncher {
    fn kind(&self) -> &'static str { "shell" }
    fn build(&self, p: &Profile) -> Result<CommandSpec> {
        Ok(CommandSpec::new(require(p, "command")?).args(p.opt_str_list("args")))
    }
}

/// PowerShell: { "edition": "core" | "desktop", "noLogo": true, "args": [] }
/// core = pwsh (multiplataforma), desktop = powershell.exe (Windows 5.1)
pub struct PowerShellLauncher;
impl Launcher for PowerShellLauncher {
    fn kind(&self) -> &'static str { "powershell" }
    fn build(&self, p: &Profile) -> Result<CommandSpec> {
        let program = match (p.opt_str("command"), p.opt_str("edition")) {
            (Some(cmd), _) => cmd.to_string(),
            (None, Some("desktop")) => "powershell.exe".into(),
            _ => "pwsh".into(),
        };
        let mut spec = CommandSpec::new(program);
        if p.opt_bool("noLogo").unwrap_or(true) {
            spec.args.push("-NoLogo".into());
        }
        let extra = p.opt_str_list("args");
        // Con args propios del usuario no tocamos nada (podrían incluir -Command).
        if extra.is_empty() && p.opt_bool("shellIntegration").unwrap_or(true) {
            spec.args.extend(["-NoExit".into(), "-Command".into(), PWSH_OSC7.into()]);
        }
        Ok(spec.args(extra))
    }
}

/// CMD de Windows.
pub struct CmdLauncher;
impl Launcher for CmdLauncher {
    fn kind(&self) -> &'static str { "cmd" }
    fn build(&self, p: &Profile) -> Result<CommandSpec> {
        Ok(CommandSpec::new("cmd.exe").args(p.opt_str_list("args")))
    }
}

/// WSL: { "distro": "Ubuntu-24.04", "user": "root", "cwd": "~" }
/// El cwd del perfil se interpreta *dentro* de la distro (wsl --cd).
pub struct WslLauncher;
impl Launcher for WslLauncher {
    fn kind(&self) -> &'static str { "wsl" }
    fn build(&self, p: &Profile) -> Result<CommandSpec> {
        let mut spec = CommandSpec::new("wsl.exe");
        if let Some(d) = p.opt_str("distro") {
            spec.args.extend(["-d".into(), d.into()]);
        }
        if let Some(u) = p.opt_str("user") {
            spec.args.extend(["-u".into(), u.into()]);
        }
        // Rutas Linux: no las expandimos en Windows, se pasan tal cual.
        spec.args.extend(["--cd".into(), p.cwd.clone().unwrap_or_else(|| "~".into())]);
        // Evitamos que el registry aplique el cwd de Windows.
        spec.cwd = Some(String::new());
        Ok(spec.args(p.opt_str_list("args")))
    }
}

/// SSH: { "host": "srv", "user": "root", "port": 22, "identityFile": "~/.ssh/id" }
pub struct SshLauncher;
impl Launcher for SshLauncher {
    fn kind(&self) -> &'static str { "ssh" }
    fn build(&self, p: &Profile) -> Result<CommandSpec> {
        let host = require(p, "host")?;
        let target = match p.opt_str("user") {
            Some(u) => format!("{u}@{host}"),
            None => host.to_string(),
        };
        let mut spec = CommandSpec::new(p.opt_str("command").unwrap_or("ssh"));
        if let Some(port) = p.opt_u64("port") {
            spec.args.extend(["-p".into(), port.to_string()]);
        }
        if let Some(id) = p.opt_str("identityFile") {
            spec.args.extend(["-i".into(), expand_home(id)]);
        }
        spec.args.extend(p.opt_str_list("args"));
        spec.args.push(target);
        Ok(spec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wsl_builds_distro_args() {
        let p = Profile::new("u", "Ubuntu", "wsl").with_option("distro", "Ubuntu");
        let s = LauncherRegistry::default().build(&p).unwrap();
        assert_eq!(s.program, "wsl.exe");
        assert_eq!(s.args, vec!["-d", "Ubuntu", "--cd", "~"]);
    }

    #[test]
    fn wsl_passes_prompt_command() {
        let p = Profile::new("u", "Ubuntu", "wsl");
        let s = LauncherRegistry::default().build(&p).unwrap();
        assert!(s.env.contains_key("PROMPT_COMMAND"));
        assert!(s.env["WSLENV"].contains("PROMPT_COMMAND"));
    }

    #[test]
    fn powershell_integration_can_be_disabled() {
        let on = Profile::new("p", "pwsh", "powershell");
        let off = Profile::new("p", "pwsh", "powershell").with_option("shellIntegration", false);
        let reg = LauncherRegistry::default();
        assert!(reg.build(&on).unwrap().args.contains(&"-NoExit".to_string()));
        assert!(!reg.build(&off).unwrap().args.contains(&"-NoExit".to_string()));
    }

    #[test]
    fn ssh_builds_target() {
        let p = Profile::new("s", "srv", "ssh")
            .with_option("host", "example.com")
            .with_option("user", "ana")
            .with_option("port", 2222);
        let s = LauncherRegistry::default().build(&p).unwrap();
        assert_eq!(s.args, vec!["-p", "2222", "ana@example.com"]);
    }

    #[test]
    fn unknown_kind_errors() {
        let p = Profile::new("x", "x", "nope");
        assert!(matches!(LauncherRegistry::default().build(&p), Err(Error::UnknownKind(_))));
    }

    #[test]
    fn shell_requires_command() {
        let p = Profile::new("x", "x", "shell");
        assert!(LauncherRegistry::default().build(&p).is_err());
    }
}
