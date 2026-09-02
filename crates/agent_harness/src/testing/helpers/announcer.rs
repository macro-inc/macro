//! Recording announcer test double.

use std::sync::{Arc, Mutex};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{SessionAnnouncement, TaskSessionAnnouncement};
use crate::domain::ports::SessionAnnouncer;

/// A [`SessionAnnouncer`] that records instead of posting. Cloning shares one
/// record.
#[derive(Clone, Default)]
pub struct AnnouncerMock {
    announced: Arc<Mutex<Vec<SessionAnnouncement>>>,
    task_announced: Arc<Mutex<Vec<TaskSessionAnnouncement>>>,
    /// When set, every announce fails with this message.
    failure: Arc<Mutex<Option<String>>>,
}

impl AnnouncerMock {
    /// An announcer that has announced nothing and will not fail.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Make every announce fail from now on.
    pub fn fails(&self, message: &str) {
        *self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned") =
            Some(message.to_owned());
    }

    /// Every announcement recorded, in order.
    #[must_use]
    pub fn announced(&self) -> Vec<SessionAnnouncement> {
        self.announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .clone()
    }

    /// Every task-discussion announcement recorded, in order.
    #[must_use]
    pub fn task_announced(&self) -> Vec<TaskSessionAnnouncement> {
        self.task_announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .clone()
    }
}

impl SessionAnnouncer for AnnouncerMock {
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<()> {
        if let Some(message) = self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned")
            .clone()
        {
            return Err(HarnessError::Announce(rootcause::report!("{message}")));
        }

        self.announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .push(announcement);
        Ok(())
    }

    async fn announce_task_assignment(&self, announcement: TaskSessionAnnouncement) -> Result<()> {
        if let Some(message) = self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned")
            .clone()
        {
            return Err(HarnessError::Announce(rootcause::report!("{message}")));
        }

        self.task_announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .push(announcement);
        Ok(())
    }
}
