//! Recording announcer test double.

use std::sync::{Arc, Mutex};

use agent_session::domain::model::AgentSession;

use crate::domain::service::{MentionOrigin, SessionAnnouncer};

/// One recorded announcement.
#[derive(Debug, Clone)]
pub struct Announced {
    /// The session as it was announced, dedicated channel id included.
    pub session: AgentSession,
    /// The mention it answered.
    pub origin: MentionOrigin,
}

/// A [`SessionAnnouncer`] that records instead of posting. Cloning shares one
/// record.
#[derive(Clone, Default)]
pub struct AnnouncerMock {
    announced: Arc<Mutex<Vec<Announced>>>,
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
    pub fn announced(&self) -> Vec<Announced> {
        self.announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .clone()
    }
}

impl SessionAnnouncer for AnnouncerMock {
    async fn announce(&self, session: &AgentSession, origin: &MentionOrigin) -> anyhow::Result<()> {
        if let Some(message) = self
            .failure
            .lock()
            .expect("announcer mock failure lock should not be poisoned")
            .clone()
        {
            anyhow::bail!("{message}");
        }

        self.announced
            .lock()
            .expect("announcer mock lock should not be poisoned")
            .push(Announced {
                session: session.clone(),
                origin: origin.clone(),
            });
        Ok(())
    }
}
