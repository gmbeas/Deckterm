//! Autodetección de shells instaladas. Se ejecuta sólo al crear la config o
//! cuando el usuario pide "redetectar" (nunca en segundo plano).

use crate::profile::Profile;
use std::path::{Path, PathBuf};

pub fn detect_profiles() -> Vec<Profile> {
    let mut out = Vec::new();

    if cfg!(windows) {
        if let Some(p) = which("pwsh") {
            out.push(
                Profile::new("pwsh", "PowerShell", "powershell")
                    .with_option("edition", "core")
                    .with_option("command", p.to_string_lossy().to_string())
                    .with_icon("⚡"),
            );
        }
        if which("powershell").is_some() {
            out.push(
                Profile::new("powershell", "Windows PowerShell", "powershell")
                    .with_option("edition", "desktop")
                    .with_icon("🔷"),
            );
        }
        out.push(Profile::new("cmd", "Símbolo del sistema", "cmd").with_icon("▪"));

        for d in wsl_distros() {
            let id = format!("wsl-{}", slug(&d));
            out.push(Profile::new(id, format!("WSL: {d}"), "wsl").with_option("distro", d).with_icon("🐧"));
        }

        let git_bash = Path::new(r"C:\Program Files\Git\bin\bash.exe");
        if git_bash.exists() {
            out.push(
                Profile::new("git-bash", "Git Bash", "shell")
                    .with_option("command", git_bash.to_string_lossy().to_string())
                    .with_option("args", vec!["--login", "-i"])
                    .with_icon("🌿"),
            );
        }
    } else {
        // macOS / Linux: $SHELL primero, luego /etc/shells.
        let mut seen = std::collections::HashSet::new();
        let mut candidates: Vec<String> = std::env::var("SHELL").into_iter().collect();
        if let Ok(s) = std::fs::read_to_string("/etc/shells") {
            candidates.extend(
                s.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(String::from),
            );
        }
        for path in candidates {
            let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            // Evitar duplicados tipo /bin/bash y /usr/bin/bash, y shells "falsas".
            if name.is_empty() || matches!(name.as_str(), "nologin" | "false" | "git-shell" | "rbash" | "tmux" | "screen" | "byobu") {
                continue;
            }
            if !Path::new(&path).exists() || !seen.insert(name.clone()) {
                continue;
            }
            out.push(
                Profile::new(name.clone(), name, "shell")
                    .with_option("command", path)
                    .with_option("args", vec!["-l"])
                    .with_icon("❯"),
            );
        }
        if let Some(p) = which("pwsh") {
            out.push(
                Profile::new("pwsh", "PowerShell", "powershell")
                    .with_option("command", p.to_string_lossy().to_string())
                    .with_icon("⚡"),
            );
        }
    }

    for p in &mut out {
        p.auto_detected = true;
    }
    out
}

/// Distros WSL instaladas. `wsl -l -q` devuelve UTF-16LE.
pub fn wsl_distros() -> Vec<String> {
    let Ok(output) = std::process::Command::new("wsl.exe").args(["-l", "-q"]).output() else {
        return vec![];
    };
    parse_wsl_list(&output.stdout)
}

pub(crate) fn parse_wsl_list(bytes: &[u8]) -> Vec<String> {
    let text = if bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).take(8).all(|b| *b == 0) {
        let u16s: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&u16s)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    };
    text.lines()
        .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0').to_string())
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .collect()
}

pub fn which(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT").unwrap_or(".EXE;.CMD;.BAT".into()).split(';').map(|e| e.to_lowercase()).collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let c = dir.join(format!("{bin}{ext}"));
            if c.is_file() {
                return Some(c);
            }
        }
    }
    None
}

fn slug(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_utf16_wsl_output() {
        let s = "Ubuntu-24.04\r\nDebian\r\ndocker-desktop\r\n";
        let bytes: Vec<u8> = s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu-24.04", "Debian"]);
    }

    #[test]
    fn detects_something_on_unix() {
        if !cfg!(windows) {
            assert!(!detect_profiles().is_empty());
        }
    }
}
