//! Gestión de pseudo-terminales.
//!
//! Usa `portable-pty`: ConPTY en Windows 10/11 (la misma API que Windows
//! Terminal) y openpty en macOS/Linux.
//!
//! Ahorro de recursos:
//! - La salida se agrupa (coalescing): se envía como mucho cada ~8 ms o al
//!   juntar 64 KB, en vez de un evento por cada lectura. Con `cat` de un archivo
//!   grande esto baja muchísimo el uso de CPU del IPC y del render.
//! - Sin polling: los hilos duermen bloqueados en read()/recv().

use crate::{error::*, launcher::CommandSpec};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize as NativeSize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
const FLUSH_BYTES: usize = 64 * 1024;
const READ_BUF: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize)]
pub struct PtySize {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone)]
pub enum PtyEvent {
    Output(Vec<u8>),
    Exit(Option<u32>),
}

pub type EventSink = Arc<dyn Fn(PtyEvent) + Send + Sync>;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default, Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl PtyManager {
    pub fn new() -> Self { Self::default() }

    pub fn spawn(&self, spec: &CommandSpec, size: PtySize, sink: EventSink) -> Result<String> {
        let pair = native_pty_system()
            .openpty(NativeSize { rows: size.rows, cols: size.cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| Error::Pty(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        match spec.cwd.as_deref() {
            Some(c) if !c.is_empty() && std::path::Path::new(c).is_dir() => cmd.cwd(c),
            _ => {
                if let Some(home) = directories::UserDirs::new() {
                    cmd.cwd(home.home_dir());
                }
            }
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| Error::Pty(format!("no se pudo iniciar '{}': {e}", spec.program)))?;
        drop(pair.slave); // importante: si no, nunca recibimos EOF al salir la shell

        let reader = pair.master.try_clone_reader().map_err(|e| Error::Pty(e.to_string()))?;
        let writer = pair.master.take_writer().map_err(|e| Error::Pty(e.to_string()))?;
        let killer = child.clone_killer();

        let id = uuid::Uuid::new_v4().to_string();
        self.sessions.lock().unwrap().insert(id.clone(), Session { master: pair.master, writer, killer });

        // Hilo 1: lee del PTY (bloqueante) y pasa trozos al hilo de agrupado.
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        thread::Builder::new().name(format!("pty-read-{id}")).spawn(move || read_loop(reader, tx))?;

        // Hilo 2: espera al proceso hijo. En ConPTY (Windows) el lector no recibe EOF
        // hasta cerrar el master, así que al salir el hijo soltamos la sesión (y su
        // master) para destrabar el hilo 1.
        let (code_tx, code_rx) = mpsc::channel::<Option<u32>>();
        let sessions = self.sessions.clone();
        let sid = id.clone();
        thread::Builder::new().name(format!("pty-wait-{id}")).spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            sessions.lock().unwrap().remove(&sid);
            let _ = code_tx.send(code);
        })?;

        // Hilo 3: agrupa la salida, la entrega y al final reporta el exit code.
        thread::Builder::new().name(format!("pty-flush-{id}")).spawn(move || {
            flush_loop(rx, &sink);
            let code = code_rx.recv().ok().flatten();
            sink(PtyEvent::Exit(code));
        })?;

        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let mut s = self.sessions.lock().unwrap();
        let sess = s.get_mut(id).ok_or_else(|| Error::SessionNotFound(id.into()))?;
        sess.writer.write_all(data)?;
        sess.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, size: PtySize) -> Result<()> {
        let s = self.sessions.lock().unwrap();
        let sess = s.get(id).ok_or_else(|| Error::SessionNotFound(id.into()))?;
        sess.master
            .resize(NativeSize { rows: size.rows, cols: size.cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| Error::Pty(e.to_string()))
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        if let Some(mut sess) = self.sessions.lock().unwrap().remove(id) {
            let _ = sess.killer.kill();
        }
        Ok(())
    }

    pub fn kill_all(&self) {
        for (_, mut s) in self.sessions.lock().unwrap().drain() {
            let _ = s.killer.kill();
        }
    }

    pub fn count(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}

fn read_loop(mut reader: Box<dyn Read + Send>, tx: mpsc::Sender<Vec<u8>>) {
    let mut buf = vec![0u8; READ_BUF];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        }
    }
}

fn flush_loop(rx: mpsc::Receiver<Vec<u8>>, sink: &EventSink) {
    let mut pending: Vec<u8> = Vec::with_capacity(READ_BUF);
    // Espera bloqueante al primer trozo; luego junta lo que llegue en la ventana.
    while let Ok(first) = rx.recv() {
        pending.extend_from_slice(&first);
        let deadline = Instant::now() + FLUSH_INTERVAL;
        while pending.len() < FLUSH_BYTES {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            match rx.recv_timeout(deadline - now) {
                Ok(chunk) => pending.extend_from_slice(&chunk),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        sink(PtyEvent::Output(std::mem::take(&mut pending)));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn spawn_echo_and_exit() {
        let mgr = PtyManager::new();
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let (done_tx, done_rx) = mpsc::channel();
        let o = out.clone();
        let sink: EventSink = Arc::new(move |e| match e {
            PtyEvent::Output(d) => o.lock().unwrap().extend(d),
            PtyEvent::Exit(c) => { let _ = done_tx.send(c); }
        });
        let spec = CommandSpec::new("/bin/sh").args(["-c", "printf hola-deckterm"]);
        mgr.spawn(&spec, PtySize { cols: 80, rows: 24 }, sink).unwrap();
        let code = done_rx.recv_timeout(Duration::from_secs(5)).expect("no terminó");
        assert_eq!(code, Some(0));
        assert!(String::from_utf8_lossy(&out.lock().unwrap()).contains("hola-deckterm"));
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn interactive_write_and_resize() {
        let mgr = PtyManager::new();
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let (done_tx, done_rx) = mpsc::channel();
        let o = out.clone();
        let sink: EventSink = Arc::new(move |e| match e {
            PtyEvent::Output(d) => o.lock().unwrap().extend(d),
            PtyEvent::Exit(c) => { let _ = done_tx.send(c); }
        });
        let id = mgr.spawn(&CommandSpec::new("/bin/sh"), PtySize { cols: 80, rows: 24 }, sink).unwrap();
        mgr.resize(&id, PtySize { cols: 120, rows: 40 }).unwrap();
        mgr.write(&id, b"stty size; exit\n").unwrap();
        done_rx.recv_timeout(Duration::from_secs(5)).expect("no terminó");
        assert!(String::from_utf8_lossy(&out.lock().unwrap()).contains("40 120"));
    }
}
