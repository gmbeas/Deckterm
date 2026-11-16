//! Información de git para mostrar en las pestañas (rama, commit, estado).
//!
//! Se ejecuta `git status --porcelain=v2 --branch`: una sola llamada que da el
//! commit, la rama, ahead/behind y si hay cambios. Para perfiles WSL se invoca
//! git *dentro* de la distro (`wsl.exe --exec git ...`).

use crate::{launcher::expand_home, profile::Profile};
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    /// None si el HEAD está desacoplado (detached).
    pub branch: Option<String>,
    /// Hash corto (7 caracteres). None en un repo sin commits.
    pub commit: Option<String>,
    /// Hay cambios sin commitear o archivos sin seguimiento.
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    /// Líneas añadidas/quitadas en el árbol de trabajo respecto a HEAD (archivos con seguimiento).
    pub added: u32,
    pub removed: u32,
}

/// Suma `git diff --numstat`: "añadidas<TAB>quitadas<TAB>ruta" (binarios: "-").
pub fn parse_numstat(out: &str) -> (u32, u32) {
    out.lines().fold((0, 0), |(a, r), l| {
        let mut p = l.split('\t');
        let add = p.next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
        let rem = p.next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
        (a + add, r + rem)
    })
}

/// Interpreta la salida de `git status --porcelain=v2 --branch`.
pub fn parse_status(out: &str) -> Option<GitInfo> {
    let mut info = GitInfo::default();
    let mut seen_header = false;
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("# branch.oid ") {
            seen_header = true;
            if rest != "(initial)" {
                info.commit = Some(rest.chars().take(7).collect());
            }
        } else if let Some(rest) = line.strip_prefix("# branch.head ") {
            seen_header = true;
            if rest != "(detached)" {
                info.branch = Some(rest.to_string());
            }
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    info.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    info.behind = n.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            info.dirty = true;
        }
    }
    seen_header.then_some(info)
}

// `--no-optional-locks` es opción global de git: va antes del subcomando.
const STATUS_ARGS: [&str; 4] = ["--no-optional-locks", "status", "--porcelain=v2", "--branch"];
const DIFF_ARGS: [&str; 4] = ["--no-optional-locks", "diff", "HEAD", "--numstat"];

fn exec(mut cmd: Command) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sin parpadeo de consola
    }
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `base` construye el comando hasta antes de los argumentos de git.
fn query(base: impl Fn() -> Command) -> Option<GitInfo> {
    let mut st = base();
    st.args(STATUS_ARGS);
    let mut info = parse_status(&exec(st)?)?;
    let mut df = base();
    df.args(DIFF_ARGS);
    if let Some(out) = exec(df) {
        (info.added, info.removed) = parse_numstat(&out);
    }
    Some(info)
}

/// git del sistema, en la carpeta `dir`.
pub fn local(dir: &str) -> Option<GitInfo> {
    query(|| {
        let mut c = Command::new("git");
        c.arg("-C").arg(dir);
        c
    })
}

/// git dentro de una distro WSL. `dir` es una ruta Linux.
pub fn wsl(distro: Option<&str>, user: Option<&str>, dir: &str) -> Option<GitInfo> {
    query(|| {
        let mut c = Command::new("wsl.exe");
        if let Some(d) = distro {
            c.args(["-d", d]);
        }
        if let Some(u) = user {
            c.args(["-u", u]);
        }
        c.args(["--cd", dir, "--exec", "git"]);
        c
    })
}

/// Resuelve el git de un perfil. `cwd` es la carpeta actual si la shell la informó.
pub fn for_profile(p: &Profile, cwd: Option<&str>) -> Option<GitInfo> {
    match p.kind.as_str() {
        "ssh" => None,
        "wsl" => {
            let dir = cwd.or(p.cwd.as_deref()).unwrap_or("~");
            wsl(p.opt_str("distro"), p.opt_str("user"), dir)
        }
        _ => {
            let dir = cwd
                .map(str::to_string)
                .or_else(|| p.cwd.as_deref().map(expand_home))
                .or_else(|| directories::UserDirs::new().map(|u| u.home_dir().display().to_string()))?;
            local(&dir)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_branch() {
        let out = "# branch.oid 1234567890abcdef\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n";
        let g = parse_status(out).unwrap();
        assert_eq!(g.branch.as_deref(), Some("main"));
        assert_eq!(g.commit.as_deref(), Some("1234567"));
        assert_eq!((g.ahead, g.behind, g.dirty), (2, 1, false));
    }

    #[test]
    fn detects_dirty_and_detached() {
        let out = "# branch.oid abcdef0123\n# branch.head (detached)\n1 .M N... 100644 100644 100644 a b file.rs\n? new.txt\n";
        let g = parse_status(out).unwrap();
        assert_eq!(g.branch, None);
        assert!(g.dirty);
    }

    #[test]
    fn initial_repo_has_no_commit() {
        let g = parse_status("# branch.oid (initial)\n# branch.head main\n").unwrap();
        assert_eq!(g.commit, None);
    }

    #[test]
    fn sums_numstat() {
        assert_eq!(parse_numstat("10\t2\ta.rs\n-\t-\timg.png\n5\t0\tb.rs\n"), (15, 2));
        assert_eq!(parse_numstat(""), (0, 0));
    }

    #[test]
    fn not_a_repo_is_none() {
        assert_eq!(parse_status(""), None);
    }
}
