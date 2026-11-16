//! Capa delgada entre la UI y deckterm-core: sólo expone comandos IPC.
//! Toda la lógica vive en el core, para poder testearla y reutilizarla.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::{ipc::Channel, Manager, RunEvent, State};
use deckterm_core::{git, presets, AppConfig, GitInfo, LauncherRegistry, Profile, PtyEvent, PtyManager, PtySize, Result};

struct AppState {
    config: Mutex<AppConfig>,
    path: PathBuf,
    /// Pestañas abiertas (para restaurarlas): state.json junto a config.json.
    state_path: PathBuf,
    pty: PtyManager,
    launchers: LauncherRegistry,
}

/// Evento que recibe cada pestaña por su propio canal.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SessionEvent {
    /// Bytes de salida en base64 (seguro para UTF-8 cortado a la mitad).
    Output { data: String },
    Exit { code: Option<u32> },
}

#[tauri::command]
fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(state: State<AppState>, config: AppConfig) -> Result<()> {
    config.save(&state.path)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
fn redetect_profiles(state: State<AppState>) -> Result<AppConfig> {
    let mut cfg = state.config.lock().unwrap();
    cfg.merge_detected();
    cfg.save(&state.path)?;
    Ok(cfg.clone())
}

/// Estado de la sesión anterior (pestañas abiertas). La UI define el formato; aquí es JSON opaco.
#[tauri::command]
fn load_state(state: State<AppState>) -> Option<serde_json::Value> {
    std::fs::read_to_string(&state.state_path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// Escritura atómica (tmp + rename), igual que la config.
#[tauri::command]
fn save_state(state: State<AppState>, value: serde_json::Value) -> Result<()> {
    if let Some(dir) = state.state_path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = state.state_path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(&value)?)?;
    std::fs::rename(tmp, &state.state_path)?;
    Ok(())
}

/// Plantillas disponibles (Claude Code, Codex, ...).
#[tauri::command]
fn list_presets() -> Vec<presets::PresetInfo> {
    presets::catalog()
}

/// Perfil resultante de aplicar una plantilla a un perfil anfitrión (PowerShell, WSL, shell).
#[tauri::command]
fn preset_profile(preset_id: String, host: Profile) -> Result<Profile> {
    let preset = presets::find(&preset_id)
        .ok_or_else(|| deckterm_core::Error::UnknownKind(format!("plantilla {preset_id}")))?;
    presets::profile_for(preset, &host)
}

#[tauri::command]
fn config_path(state: State<AppState>) -> String {
    state.path.display().to_string()
}

#[tauri::command]
fn list_kinds(state: State<AppState>) -> Vec<&'static str> {
    state.launchers.kinds()
}

/// Rama/commit/estado git de la carpeta actual de una pestaña. Corre en un hilo
/// aparte porque lanza un proceso (`git`) que puede tardar en repos grandes.
#[tauri::command]
async fn git_info(state: State<'_, AppState>, profile_id: String, cwd: Option<String>) -> Result<Option<GitInfo>> {
    let profile = state.config.lock().unwrap().profile(&profile_id)?.clone();
    let info = tauri::async_runtime::spawn_blocking(move || git::for_profile(&profile, cwd.as_deref()))
        .await
        .ok()
        .flatten();
    Ok(info)
}

#[tauri::command]
fn spawn_session(
    state: State<AppState>,
    profile_id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_event: Channel<SessionEvent>,
) -> Result<String> {
    let spec = {
        let cfg = state.config.lock().unwrap();
        let mut profile = cfg.profile(&profile_id)?.clone();
        // Al restaurar pestañas se abre en la última carpeta conocida.
        if let Some(c) = cwd.filter(|c| !c.is_empty()) {
            profile.cwd = Some(c);
        }
        state.launchers.build(&profile)?
    };
    let sink = Arc::new(move |e: PtyEvent| {
        let msg = match e {
            PtyEvent::Output(bytes) => SessionEvent::Output { data: B64.encode(bytes) },
            PtyEvent::Exit(code) => SessionEvent::Exit { code },
        };
        let _ = on_event.send(msg);
    });
    state.pty.spawn(&spec, PtySize { cols, rows }, sink)
}

#[tauri::command]
fn write_session(state: State<AppState>, id: String, data: String) -> Result<()> {
    state.pty.write(&id, data.as_bytes())
}

/// Entrada binaria (xterm `onBinary`): bytes crudos, sin recodificar a UTF-8.
#[tauri::command]
fn write_session_raw(state: State<AppState>, id: String, data: Vec<u8>) -> Result<()> {
    state.pty.write(&id, &data)
}

#[tauri::command]
fn resize_session(state: State<AppState>, id: String, cols: u16, rows: u16) -> Result<()> {
    state.pty.resize(&id, PtySize { cols, rows })
}

#[tauri::command]
fn kill_session(state: State<AppState>, id: String) -> Result<()> {
    state.pty.kill(&id)
}

pub fn run() {
    AppConfig::migrate_legacy(); // trae la config de la versión anterior (TermHub), si existe
    let path = AppConfig::default_path();
    let config = AppConfig::load_or_init(&path).unwrap_or_else(|e| {
        eprintln!("config inválida ({e}); usando valores por defecto");
        AppConfig::default()
    });

    let app = tauri::Builder::default()
        .manage(AppState {
            config: Mutex::new(config),
            state_path: path.with_file_name("state.json"),
            path,
            pty: PtyManager::new(),
            launchers: LauncherRegistry::default(),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            redetect_profiles,
            config_path,
            list_presets,
            preset_profile,
            load_state,
            save_state,
            list_kinds,
            git_info,
            spawn_session,
            write_session,
            write_session_raw,
            resize_session,
            kill_session
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar Deckterm");

    app.run(|handle, event| {
        // Al cerrar la app no dejamos shells huérfanas.
        if let RunEvent::Exit = event {
            handle.state::<AppState>().pty.kill_all();
        }
    });
}
