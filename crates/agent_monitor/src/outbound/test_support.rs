//! Running a source in a test: start it, collect what it sends, stop it.

use std::path::Path;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::domain::model::SourceState;
use crate::domain::observation::{Change, Observation};
use crate::domain::source::{AgentSource, SourceError};

/// How long a test waits for a source to report something pushed to it.
pub(crate) const PUSH_DEADLINE: Duration = Duration::from_secs(1);

pub(crate) struct Running {
    observations: mpsc::Receiver<Observation>,
    cancel: CancellationToken,
    task: JoinHandle<Result<(), SourceError>>,
}

pub(crate) fn start(source: Box<dyn AgentSource>) -> Running {
    let (out, observations) = mpsc::channel(1024);
    let cancel = CancellationToken::new();
    let task = tokio::spawn(source.run(out, cancel.clone()));
    Running {
        observations,
        cancel,
        task,
    }
}

impl Running {
    /// Every change up to and including the first healthy report with no
    /// indexing left: the source's startup.
    pub async fn until_ready(&mut self) -> Vec<Change> {
        let mut changes = Vec::new();
        loop {
            let change = self.next().await;
            let ready = matches!(
                &change,
                Change::Health(health)
                    if health.state == SourceState::Healthy && health.indexing.is_none()
            );
            changes.push(change);
            if ready {
                return changes;
            }
        }
    }

    /// The next change other than a health report, within [`PUSH_DEADLINE`].
    pub async fn next_fact(&mut self) -> Change {
        loop {
            let change = self.next().await;
            if !matches!(change, Change::Health(_)) {
                return change;
            }
        }
    }

    /// The next change of any kind, within [`PUSH_DEADLINE`].
    pub async fn next(&mut self) -> Change {
        tokio::time::timeout(PUSH_DEADLINE, self.observations.recv())
            .await
            .expect("the source reported within the deadline")
            .expect("the source is running")
            .change
    }

    pub async fn stop(self) {
        self.cancel.cancel();
        let result = self.task.await.expect("source task joined");
        assert!(result.is_ok(), "{result:?}");
    }
}

/// Copies a fixture directory tree.
pub(crate) fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("mkdir");
    for entry in std::fs::read_dir(from).expect("read fixture dir") {
        let entry = entry.expect("entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("type").is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).expect("copy");
        }
    }
}

/// The crate's fixture directory.
pub(crate) fn fixtures() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures"))
}
