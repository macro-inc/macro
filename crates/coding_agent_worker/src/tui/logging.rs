use std::collections::VecDeque;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

#[cfg(test)]
mod test;

/// A saved log rotates to `<file>.1` (replacing an older one) at this size, so
/// one panel keeps at most twice this on disk.
const SAVED_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// The daemon's own log lines, rendered by the Logs tab and, once
/// [`LogBuffer::save_to`] names a file, appended to it so they outlive the
/// process.
///
/// The TUI owns the terminal, so tracing must not write to it; this is the
/// sink the subscriber writes into instead.
#[derive(Clone, Default)]
pub struct LogBuffer {
    lines: Arc<Mutex<VecDeque<String>>>,
    saved: Arc<Mutex<Option<SavedLog>>>,
}

struct SavedLog {
    path: PathBuf,
    /// The last append failed, so the panel was already told.
    failing: bool,
}

impl LogBuffer {
    const CAPACITY: usize = 500;

    /// Install the global tracing subscriber writing into a fresh buffer.
    pub fn install() -> Self {
        let buffer = Self::default();
        let sink = buffer.clone();
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
            )
            .with_ansi(false)
            .with_writer(move || sink.clone())
            .init();
        buffer
    }

    /// The saved log of the panel using `config`: `logs/<config name>.log`
    /// beside it, so panels with different configs keep separate logs, and the
    /// config's lock leaves each log one writer.
    pub fn path_for(config: &Path) -> PathBuf {
        let mut name = config
            .file_stem()
            .unwrap_or(OsStr::new("macrod"))
            .to_owned();
        name.push(".log");
        config
            .parent()
            .unwrap_or(Path::new(""))
            .join("logs")
            .join(name)
    }

    /// Also append every line from now on to the file at `path`.
    pub fn save_to(&self, path: PathBuf) {
        *self.saved.lock().unwrap_or_else(PoisonError::into_inner) = Some(SavedLog {
            path,
            failing: false,
        });
    }

    /// Where lines are saved, once they are.
    pub(crate) fn saved_to(&self) -> Option<PathBuf> {
        self.saved
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|saved| saved.path.clone())
    }

    /// The most recent lines, oldest first.
    pub(crate) fn tail(&self, count: usize) -> Vec<String> {
        let lines = self.lines.lock().unwrap_or_else(PoisonError::into_inner);
        lines.iter().rev().take(count).rev().cloned().collect()
    }

    fn keep(&self, bytes: &[u8]) {
        let mut lines = self.lines.lock().unwrap_or_else(PoisonError::into_inner);
        for line in String::from_utf8_lossy(bytes).lines() {
            if line.trim().is_empty() {
                continue;
            }
            if lines.len() == Self::CAPACITY {
                lines.pop_front();
            }
            lines.push_back(line.to_owned());
        }
    }

    fn save(&self, bytes: &[u8]) {
        let mut saved = self.saved.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(log) = saved.as_mut() else {
            return;
        };
        match crate::log_file::append(&log.path, SAVED_MAX_BYTES, bytes) {
            Ok(()) => log.failing = false,
            Err(_) if log.failing => {}
            Err(error) => {
                log.failing = true;
                // Not through tracing: this is its writer.
                let warning = format!(
                    "{} WARN macrod: could not save logs to {}: {error}",
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true),
                    log.path.display()
                );
                drop(saved);
                self.keep(warning.as_bytes());
            }
        }
    }
}

impl std::io::Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.keep(bytes);
        self.save(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
