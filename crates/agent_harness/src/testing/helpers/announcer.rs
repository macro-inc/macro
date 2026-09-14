//! Recording announcer test double.

use std::sync::{Arc, Mutex};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{AnnouncedMessage, SessionAnnouncement};
use crate::domain::ports::SessionAnnouncer;

/// A [`SessionAnnouncer`] that records instead of posting. Cloning shares one
/// record.
#[derive(Clone, Default)]
pub struct AnnouncerMock {
    announced: Arc<Mutex<Vec<(SessionAnnouncement, AnnouncedMessage)>>>,
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
            .iter()
            .map(|(announcement, _)| announcement.clone())
            .collect()
    }

    /// The message each recorded announcement became, in order.
    #[must_use]
    pub fn announced_messages(&self) -> Vec<AnnouncedMessage> {
        self.announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .iter()
            .map(|(_, message)| *message)
            .collect()
    }
}

impl SessionAnnouncer for AnnouncerMock {
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<AnnouncedMessage> {
        if let Some(message) = self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned")
            .clone()
        {
            return Err(HarnessError::Announce(rootcause::report!("{message}")));
        }

        let message = AnnouncedMessage {
            message_id: macro_uuid::generate_uuid_v7(),
        };
        self.announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .push((announcement, message));
        Ok(message)
    }
}
