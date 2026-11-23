//! The `contacts-list-writes` rollout gate for list-aware directory messages.
//!
//! Contacts workers released before the list-aware messages delete them as
//! unparseable, so producers send them only once the flag is on, after every
//! worker runs a release that reads them. Legacy messages are never gated.

use crate::domain::models::{list::InboxSource, messages::ContactConnection};
use crate::domain::ports::{ContactListIngress, ContactsIngress};
use feature_flags::{ServiceContext, ServiceFeatureFlags};
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

#[cfg(test)]
mod test;

/// The PostHog flag that turns list-aware directory messages on.
pub const CONTACT_LIST_WRITES_FLAG: &str = "contacts-list-writes";

/// The stable distinct id the flag is evaluated for, in every service that
/// produces directory changes, so the rollout is one global decision.
pub const CONTACT_LIST_WRITES_CONTEXT: ServiceContext = ServiceContext::new("contacts-list-writes");

/// How long one read of the flag is used, so a busy producer reads it about
/// once a minute rather than once per event.
const FLAG_TTL: Duration = Duration::from_secs(60);

/// Whether list-aware directory messages are sent.
pub enum ContactListWrites<F> {
    /// The same answer always: on in a local stack, off without flags.
    Fixed(bool),
    /// Read from the flag, cached for a minute. A failed or missing read is off.
    Flag {
        /// The service flag evaluator.
        flags: F,
        /// The last read and when it was made.
        last: Mutex<Option<(Instant, bool)>>,
    },
}

impl<F: ServiceFeatureFlags> ContactListWrites<F> {
    /// On in a local stack, which has no PostHog project; elsewhere read from
    /// `flags`, and off without them.
    pub fn new(environment: Environment, flags: Option<F>) -> Self {
        match (environment, flags) {
            (Environment::Local, _) => Self::Fixed(true),
            (_, None) => Self::Fixed(false),
            (_, Some(flags)) => Self::Flag {
                flags,
                last: Mutex::new(None),
            },
        }
    }

    /// Whether to send list-aware messages now.
    pub async fn enabled(&self) -> bool {
        let (flags, last) = match self {
            Self::Fixed(enabled) => return *enabled,
            Self::Flag { flags, last } => (flags, last),
        };
        // Held across the read, so concurrent events wait for one read.
        let mut last = last.lock().await;
        if let Some((at, enabled)) = *last
            && at.elapsed() < FLAG_TTL
        {
            return enabled;
        }
        let enabled = read(flags).await;
        *last = Some((Instant::now(), enabled));
        enabled
    }
}

/// One read of the flag; a failed read is off until the next one.
#[tracing::instrument(
    name = "contacts.list_writes_flag.read",
    skip_all,
    fields(feature_flag.key = CONTACT_LIST_WRITES_FLAG, feature_flag.enabled = tracing::field::Empty)
)]
async fn read<F: ServiceFeatureFlags>(flags: &F) -> bool {
    let enabled = match flags.load_service(CONTACT_LIST_WRITES_CONTEXT).await {
        Ok(snapshot) => snapshot.is_enabled(CONTACT_LIST_WRITES_FLAG),
        Err(error) => {
            tracing::warn!(
                ?error,
                "could not read the contacts list writes flag; it is off"
            );
            false
        }
    };
    tracing::Span::current().record("feature_flag.enabled", enabled);
    enabled
}

/// A contacts producer whose list-aware messages wait for the flag. Legacy
/// messages pass through unchanged; list-aware calls succeed without sending
/// anything while the flag is off.
pub struct ListWritesGate<I, F> {
    /// The ingress both kinds of message are sent through.
    pub inner: I,
    /// Whether list-aware messages are sent.
    pub writes: ContactListWrites<F>,
}

impl<I: ContactsIngress, F: ServiceFeatureFlags + 'static> ContactsIngress
    for ListWritesGate<I, F>
{
    async fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        self.inner.enqueue_contacts(users).await
    }

    async fn enqueue_contact_connections(
        &self,
        connections: Vec<ContactConnection>,
    ) -> Result<(), Report> {
        self.inner.enqueue_contact_connections(connections).await
    }
}

impl<I: ContactListIngress, F: ServiceFeatureFlags + 'static> ContactListIngress
    for ListWritesGate<I, F>
{
    async fn record_interactions(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        peers: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        if !self.writes.enabled().await {
            return Ok(());
        }
        self.inner.record_interactions(users, peers).await
    }

    async fn record_inbox_contacts(
        &self,
        inbox: InboxSource,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        if !self.writes.enabled().await {
            return Ok(());
        }
        self.inner.record_inbox_contacts(inbox, contacts).await
    }

    async fn directory_changed(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        changed: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        if !self.writes.enabled().await {
            return Ok(());
        }
        self.inner.directory_changed(users, changed).await
    }

    async fn user_deleted(&self, user: MacroUserIdStr<'static>) -> Result<(), Report> {
        if !self.writes.enabled().await {
            return Ok(());
        }
        self.inner.user_deleted(user).await
    }
}
