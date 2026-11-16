use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("perfil no encontrado: {0}")]
    ProfileNotFound(String),
    #[error("tipo de perfil desconocido: {0}")]
    UnknownKind(String),
    #[error("opción inválida en el perfil '{profile}': {message}")]
    InvalidOption { profile: String, message: String },
    #[error("sesión no encontrada: {0}")]
    SessionNotFound(String),
    #[error("error de PTY: {0}")]
    Pty(String),
    #[error("error de E/S: {0}")]
    Io(#[from] std::io::Error),
    #[error("error de JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

// Para que Tauri pueda devolver errores al frontend como string.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
