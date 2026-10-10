//! Recording announcer test double.

use std::sync::{Arc, Mutex};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    AgentTypingUpdate, AnnouncedMessage, DeclinedMention, ReplyPresentation, ResolvedReply,
    SessionAnnouncement,
};
use crate::domain::ports::SessionAnnouncer;

/// A [`SessionAnnouncer`] that records instead of posting. Cloning shares one
/// record.
#[derive(Clone, Default)]
pub struct AnnouncerMock {
    announced: Arc<Mutex<Vec<(SessionAnnouncement, AnnouncedMessage)>>>,
    declined: Arc<Mutex<Vec<DeclinedMention>>>,
    resolved: Arc<Mutex<Vec<ResolvedReply>>>,
    presented: Arc<Mutex<Vec<ReplyPresentation>>>,
    typed: Arc<Mutex<Vec<AgentTypingUpdate>>>,
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

    /// Stop failing: the next announce, resolve or presentation succeeds.
    pub fn recovers(&self) {
        *self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned") = None;
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

    /// Every mention declined, in order.
    #[must_use]
    pub fn declined(&self) -> Vec<DeclinedMention> {
        self.declined
            .lock()
            .expect("announcer mock declined lock should not be poisoned")
            .clone()
    }

    /// Every reply resolved, in order - for a coding kind too, since
    /// deciding that there is nothing to patch is the real adapter's job.
    #[must_use]
    pub fn resolved(&self) -> Vec<ResolvedReply> {
        self.resolved
            .lock()
            .expect("announcer mock resolved lock should not be poisoned")
            .clone()
    }

    /// Every reply message shown, in order, including each update to one.
    #[must_use]
    pub fn presented(&self) -> Vec<ReplyPresentation> {
        self.presented
            .lock()
            .expect("announcer mock presented lock should not be poisoned")
            .clone()
    }

    /// Every typing update, in order.
    #[must_use]
    pub fn typed(&self) -> Vec<AgentTypingUpdate> {
        self.typed
            .lock()
            .expect("announcer mock typed lock should not be poisoned")
            .clone()
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
            message_id: if announcement.reuse_origin_message {
                announcement.origin_message_id
            } else {
                macro_uuid::generate_uuid_v7()
            },
        };
        self.announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .push((announcement, message));
        Ok(message)
    }

    async fn resolve(&self, resolution: ResolvedReply) -> Result<()> {
        if let Some(message) = self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned")
            .clone()
        {
            return Err(HarnessError::Announce(rootcause::report!("{message}")));
        }
        self.resolved
            .lock()
            .expect("announcer mock resolved lock should not be poisoned")
            .push(resolution);
        Ok(())
    }

    async fn decline(&self, declined: DeclinedMention) -> Result<()> {
        if let Some(message) = self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned")
            .clone()
        {
            return Err(HarnessError::Announce(rootcause::report!("{message}")));
        }
        self.declined
            .lock()
            .expect("announcer mock declined lock should not be poisoned")
            .push(declined);
        Ok(())
    }

    async fn present(&self, presentation: ReplyPresentation) -> Result<()> {
        if let Some(message) = self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned")
            .clone()
        {
            return Err(HarnessError::Announce(rootcause::report!("{message}")));
        }
        self.presented
            .lock()
            .expect("announcer mock presented lock should not be poisoned")
            .push(presentation);
        Ok(())
    }

    async fn typing(&self, typing: AgentTypingUpdate) -> Result<()> {
        self.typed
            .lock()
            .expect("announcer mock typed lock should not be poisoned")
            .push(typing);
        Ok(())
    }
}
