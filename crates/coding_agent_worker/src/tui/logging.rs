use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// The daemon's own log lines, rendered by the Logs tab.
///
/// The TUI owns the terminal, so tracing must not write to it; this is the
/// sink the subscriber writes into instead.
#[derive(Clone, Default)]
pub struct LogBuffer {
    lines: Arc<Mutex<VecDeque<String>>>,
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

    /// The most recent lines, oldest first.
    pub(crate) fn tail(&self, count: usize) -> Vec<String> {
        let lines = self.lines.lock().expect("log buffer lock");
        lines.iter().rev().take(count).rev().cloned().collect()
    }
}

impl std::io::Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let mut lines = self.lines.lock().expect("log buffer lock");
        for line in String::from_utf8_lossy(bytes).lines() {
            if line.trim().is_empty() {
                continue;
            }
            if lines.len() == Self::CAPACITY {
                lines.pop_front();
            }
            lines.push_back(line.to_owned());
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
