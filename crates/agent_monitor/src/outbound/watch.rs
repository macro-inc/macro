//! File-system notifications as an async stream: inotify on Linux, FSEvents on
//! macOS, through `notify`. Sources wake on these, never on a timer.

#[cfg(test)]
mod test;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use tokio::sync::mpsc;

/// What the watcher saw since the last [`Watch::next`].
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Changes {
    /// Paths that were created, written, renamed or removed.
    pub paths: BTreeSet<PathBuf>,
    /// The kernel dropped events (queue overflow) or the watcher failed; the
    /// source must rescan what it watches.
    pub rescan: bool,
}

/// A live set of watches. Dropping it removes them.
pub(crate) struct Watch {
    watcher: RecommendedWatcher,
    events: mpsc::UnboundedReceiver<notify::Result<notify::Event>>,
}

impl Watch {
    /// A watcher with nothing watched yet.
    pub fn new() -> notify::Result<Self> {
        let (sender, events) = mpsc::unbounded_channel();
        let watcher = notify::recommended_watcher(move |event| {
            // The receiver is gone only while the source shuts down.
            let _ = sender.send(event);
        })?;
        Ok(Self { watcher, events })
    }

    /// Watches a directory, and with `recursive` every directory below it,
    /// including ones created later.
    pub fn add(&mut self, path: &Path, recursive: bool) -> notify::Result<()> {
        let mode = if recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        self.watcher.watch(path, mode)
    }

    /// Waits for the next change, then takes every change already queued, so
    /// a burst of writes is handled once. `None` once the watcher has stopped.
    pub async fn next(&mut self) -> Option<Changes> {
        let first = self.events.recv().await?;
        let mut changes = Changes::default();
        absorb(&mut changes, first);
        while let Ok(event) = self.events.try_recv() {
            absorb(&mut changes, event);
        }
        Some(changes)
    }
}

fn absorb(changes: &mut Changes, event: notify::Result<notify::Event>) {
    let event = match event {
        Ok(event) => event,
        Err(error) => {
            tracing::warn!(error = %error, "file watcher error; rescanning");
            changes.rescan = true;
            return;
        }
    };

    if event.need_rescan() {
        changes.rescan = true;
    }

    // Reads and metadata-only changes (atime) carry nothing to re-read.
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    changes.paths.extend(event.paths);
}
