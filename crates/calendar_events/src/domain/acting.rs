//! Who a calendar mutation acts as, and through whose account it writes.

use super::models::{CalendarAttendee, CalendarLinkTokenIdentity};

/// The acting user's own connected-inbox addresses.
///
/// These are the attendee rows the user may RSVP as, and the rows a viewer
/// sees marked as `(you)`. The set is non-empty, lowercased, and
/// deduplicated. Constructors only accept addresses from inboxes the
/// requester owns (`email_links.macro_id = requester`), so a delegated
/// subject's address cannot enter this type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActorInboxes {
    emails: Vec<String>,
}

impl ActorInboxes {
    /// Normalize the requester's owned inbox addresses.
    ///
    /// Returns `None` when the requester owns no connected inbox. RSVP
    /// treats that as [`super::ports::CalendarMutationError::NotAttendee`]
    /// when acting on behalf of someone else. Display leaves provider
    /// `is_self` flags untouched.
    pub(crate) fn from_owned(owned_inbox_emails: Vec<String>) -> Option<Self> {
        let mut emails: Vec<String> = owned_inbox_emails
            .into_iter()
            .map(|email| email.to_ascii_lowercase())
            .filter(|email| !email.is_empty())
            .collect();
        emails.sort();
        emails.dedup();
        if emails.is_empty() {
            None
        } else {
            Some(Self { emails })
        }
    }

    /// A single-address identity used when acting as self and the owned
    /// catalog is empty, including FakeRepo fixtures.
    pub(crate) fn sole(email: impl Into<String>) -> Self {
        Self {
            emails: vec![email.into().to_ascii_lowercase()],
        }
    }

    fn with(mut self, email: &str) -> Self {
        let email = email.to_ascii_lowercase();
        if email.is_empty() || self.emails.iter().any(|existing| existing == &email) {
            return self;
        }
        self.emails.push(email);
        self.emails.sort();
        self
    }

    /// Whether an attendee address belongs to the actor.
    pub fn matches(&self, email: &str) -> bool {
        let email = email.to_ascii_lowercase();
        self.emails.iter().any(|existing| existing == &email)
    }

    /// Set `is_self` on the actor's rows and clear it on every other row.
    pub fn mark_attendees(&self, attendees: &mut [CalendarAttendee]) {
        for attendee in attendees {
            attendee.is_self = self.matches(&attendee.email);
        }
    }

    /// Iterate the normalized addresses.
    pub fn iter(&self) -> impl Iterator<Item = &str> {
        self.emails.iter().map(String::as_str)
    }
}

/// Who a calendar mutation acts as, and through whose grant it writes.
///
/// Resolved when the mutation target is resolved, so actor identity is
/// loaded before any provider write. RSVP row selection and viewer `(you)`
/// marking both come from the actor side. The token and the stored Google
/// event always come from the account side.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarActingIdentity {
    /// The requester owns the connected inbox.
    AsSelf {
        /// Token identity of the requester's own connected inbox.
        account: CalendarLinkTokenIdentity,
        /// The requester's owned inbox addresses. Always contains
        /// `account.email_address`.
        actor: ActorInboxes,
    },
    /// The requester acts through another user's connected inbox.
    OnBehalfOf {
        /// The requester's owned inbox addresses. `None` when they own no
        /// inbox: update and delete still work, RSVP is not an attendee.
        actor: Option<ActorInboxes>,
        /// Token identity of the delegated account the write goes through.
        subject: CalendarLinkTokenIdentity,
    },
}

impl CalendarActingIdentity {
    /// The requester owns `account`. The account address is unioned into
    /// the actor set so an empty owned-inbox catalog still has a defined
    /// RSVP identity.
    pub(crate) fn as_self(
        account: CalendarLinkTokenIdentity,
        owned_inbox_emails: Vec<String>,
    ) -> Self {
        let actor = ActorInboxes::from_owned(owned_inbox_emails)
            .map(|actor| actor.with(&account.email_address))
            .unwrap_or_else(|| ActorInboxes::sole(account.email_address.clone()));
        Self::AsSelf { account, actor }
    }

    /// The requester reaches `subject` through a delegation.
    ///
    /// The subject's address is not added to the actor set.
    pub(crate) fn on_behalf_of(
        subject: CalendarLinkTokenIdentity,
        owned_inbox_emails: Vec<String>,
    ) -> Self {
        Self::OnBehalfOf {
            actor: ActorInboxes::from_owned(owned_inbox_emails),
            subject,
        }
    }

    /// The grant that authorizes the provider write.
    pub fn token_identity(&self) -> &CalendarLinkTokenIdentity {
        match self {
            Self::AsSelf { account, .. } => account,
            Self::OnBehalfOf { subject, .. } => subject,
        }
    }

    /// The actor's owned inbox rows, when they have any.
    ///
    /// [`Self::AsSelf`] always returns `Some`.
    pub fn actor(&self) -> Option<&ActorInboxes> {
        match self {
            Self::AsSelf { actor, .. } => Some(actor),
            Self::OnBehalfOf { actor, .. } => actor.as_ref(),
        }
    }
}

#[cfg(test)]
mod test;
