// Tipos y llamadas IPC al backend Rust. Única puerta de entrada al backend.
import { invoke, Channel } from "@tauri-apps/api/core";

export interface ProfileAppearance {
  theme?: string;
  fontFamily?: string;
  fontSize?: number;
  cursorStyle?: "block" | "bar" | "underline";
  opacity?: number;
}

export interface Profile {
  id: string;
  name: string;
  kind: string;
  options: Record<string, unknown>;
  cwd?: string;
  env?: Record<string, string>;
  appearance: ProfileAppearance;
  icon?: string;
  color?: string;
  hidden: boolean;
  autoDetected: boolean;
}

export interface Appearance {
  theme: string;
  fontFamily: string;
  fontSize: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  gpu: boolean;
  bottomPrompt: boolean;
  language: string;
  restoreTabs: boolean;
}

export type Theme = Record<string, string>;

export interface AppConfig {
  version: number;
  defaultProfile?: string | null;
  appearance: Appearance;
  profiles: Profile[];
  themes: Record<string, Theme>;
  keybindings: Record<string, string>;
}

export interface GitInfo {
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  added: number;
  removed: number;
}

/** Una pestaña guardada para restaurarla al iniciar. */
export interface SavedTab {
  profileId: string;
  cwd?: string;
  name?: string;
  subtitle?: string;
  heading?: string;
  color?: string;
  icon?: string;
  group?: string;
  pinned?: boolean;
}
export interface SavedState {
  tabs: SavedTab[];
  active: number;
  collapsed: string[];
}

export interface PresetInfo {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export type SessionEvent =
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null };

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  redetect: () => invoke<AppConfig>("redetect_profiles"),
  configPath: () => invoke<string>("config_path"),
  listKinds: () => invoke<string[]>("list_kinds"),
  presets: () => invoke<PresetInfo[]>("list_presets"),
  presetProfile: (presetId: string, host: Profile) => invoke<Profile>("preset_profile", { presetId, host }),
  loadState: () => invoke<SavedState | null>("load_state"),
  saveState: (value: SavedState) => invoke<void>("save_state", { value }),
  gitInfo: (profileId: string, cwd?: string) => invoke<GitInfo | null>("git_info", { profileId, cwd: cwd ?? null }),

  spawn(profileId: string, cols: number, rows: number, cwd: string | undefined, onEvent: (e: SessionEvent) => void) {
    const ch = new Channel<SessionEvent>();
    ch.onmessage = onEvent;
    return invoke<string>("spawn_session", { profileId, cols, rows, cwd: cwd ?? null, onEvent: ch });
  },
  write: (id: string, data: string) => invoke<void>("write_session", { id, data }),
  /** `data` = cadena binaria de xterm (1 char = 1 byte). */
  writeBinary: (id: string, data: string) =>
    invoke<void>("write_session_raw", { id, data: Array.from(data, (c) => c.charCodeAt(0) & 0xff) }),
  resize: (id: string, cols: number, rows: number) => invoke<void>("resize_session", { id, cols, rows }),
  kill: (id: string) => invoke<void>("kill_session", { id }),
};

/** Mezcla apariencia global con la del perfil. */
export function resolveAppearance(cfg: AppConfig, p: Profile): Appearance & { opacity: number } {
  const a = p.appearance ?? {};
  return {
    ...cfg.appearance,
    theme: a.theme ?? cfg.appearance.theme,
    fontFamily: a.fontFamily ?? cfg.appearance.fontFamily,
    fontSize: a.fontSize ?? cfg.appearance.fontSize,
    cursorStyle: a.cursorStyle ?? cfg.appearance.cursorStyle,
    opacity: a.opacity ?? 1,
  };
}
