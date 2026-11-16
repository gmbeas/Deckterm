use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// Un perfil = "cómo abrir una terminal concreta".
///
/// `kind` decide qué [`crate::Launcher`] lo interpreta ("shell", "powershell",
/// "cmd", "wsl", "ssh"...). Las opciones específicas de cada tipo van en
/// `options` como JSON libre, así añadir un tipo nuevo no obliga a tocar este
/// struct ni migrar la configuración.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub kind: String,

    /// Opciones propias del tipo. Ej. wsl: { "distro": "Ubuntu" }.
    #[serde(default)]
    pub options: Map<String, Value>,

    /// Directorio inicial. Admite `~`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,

    /// Variables de entorno extra.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,

    /// Sobrescrituras de apariencia sólo para este perfil.
    #[serde(default)]
    pub appearance: ProfileAppearance,

    /// Icono (emoji o nombre) y color de acento para la pestaña.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,

    /// Ocultar del menú sin borrarlo.
    #[serde(default)]
    pub hidden: bool,

    /// true si lo creó la autodetección (útil para refrescar sin pisar los del usuario).
    #[serde(default)]
    pub auto_detected: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAppearance {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f32>,
}

impl Profile {
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind: kind.into(),
            options: Map::new(),
            cwd: None,
            env: BTreeMap::new(),
            appearance: ProfileAppearance::default(),
            icon: None,
            color: None,
            hidden: false,
            auto_detected: false,
        }
    }

    pub fn with_option(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.options.insert(key.to_string(), value.into());
        self
    }

    pub fn with_icon(mut self, icon: &str) -> Self {
        self.icon = Some(icon.to_string());
        self
    }

    pub fn opt_str(&self, key: &str) -> Option<&str> {
        self.options.get(key).and_then(Value::as_str)
    }

    pub fn opt_u64(&self, key: &str) -> Option<u64> {
        self.options.get(key).and_then(Value::as_u64)
    }

    pub fn opt_bool(&self, key: &str) -> Option<bool> {
        self.options.get(key).and_then(Value::as_bool)
    }

    /// Lista de strings (p.ej. `args`).
    pub fn opt_str_list(&self, key: &str) -> Vec<String> {
        self.options
            .get(key)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default()
    }
}
