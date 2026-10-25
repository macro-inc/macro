//! The clicker's owned inboxes.

use uuid::Uuid;

use super::models::{CalendarAttendee, CalendarEvent, CalendarProvider, ViewerCapabilities};

/// One connected inbox the clicker owns.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnedInbox {
    /// The inbox's email link. Every copy of an event synced through the
    /// inbox carries it as its source link.
    pub link_id: Uuid,
    /// The inbox's address.
    pub email: String,
    /// The provider the inbox's calendar syncs from.
    pub provider: CalendarProvider,
}

impl OwnedInbox {
    /// Whether an attendee address is this inbox's.
    pub fn matches(&self, email: &str) -> bool {
        self.email.eq_ignore_ascii_case(email)
    }
}

/// The clicker's own connected inboxes.
///
/// These are the addresses the user may RSVP as. Each copy of an event syncs
/// through one inbox, and the clicker relates to that copy only through it:
/// its attendee row is the one a viewer sees marked `(you)`, and whether it
/// organizes or attends decides what the clicker may do with the copy. The
/// set is non-empty, lowercased, and deduplicated. Constructors only accept
/// inboxes the requester owns (`email_links.macro_id = requester`), so a
/// calendar owner's address cannot enter this type unless the clicker owns
/// that inbox too.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActorInboxes {
    inboxes: Vec<OwnedInbox>,
}

impl ActorInboxes {
    /// Normalize the requester's owned inboxes.
    ///
    /// Returns `None` when the requester owns no connected inbox. RSVP
    /// treats that as [`super::ports::CalendarMutationError::NotAttendee`].
    /// Display leaves provider `is_self` flags untouched.
    pub(crate) fn from_owned(owned_inboxes: Vec<OwnedInbox>) -> Option<Self> {
        let mut inboxes: Vec<OwnedInbox> = owned_inboxes
            .into_iter()
            .map(|inbox| OwnedInbox {
                email: inbox.email.to_ascii_lowercase(),
                ..inbox
            })
            .filter(|inbox| !inbox.email.is_empty())
            .collect();
        inboxes
            .sort_by(|left, right| (&left.email, left.link_id).cmp(&(&right.email, right.link_id)));
        inboxes.dedup_by_key(|inbox| inbox.link_id);
        if inboxes.is_empty() {
            None
        } else {
            Some(Self { inboxes })
        }
    }

    /// A single Google inbox for fixtures.
    #[cfg(test)]
    pub(crate) fn sole(email: impl Into<String>) -> Self {
        Self {
            inboxes: vec![OwnedInbox {
                link_id: Uuid::nil(),
                email: email.into().to_ascii_lowercase(),
                provider: CalendarProvider::Google,
            }],
        }
    }

    /// Whether an attendee address belongs to the actor.
    pub fn matches(&self, email: &str) -> bool {
        self.inboxes.iter().any(|inbox| inbox.matches(email))
    }

    /// Restrict a response to one address already verified as owned by the requester.
    pub(crate) fn select(&self, email: &str) -> Option<Self> {
        let inboxes: Vec<OwnedInbox> = self
            .inboxes
            .iter()
            .filter(|inbox| inbox.matches(email))
            .cloned()
            .collect();
        (!inboxes.is_empty()).then_some(Self { inboxes })
    }

    /// The actor's inbox a copy syncs through, by the copy's source link.
    /// `None` when the actor does not own it, as for a delegate looking at
    /// the inbox they were granted.
    pub fn inbox(&self, link_id: Uuid) -> Option<&OwnedInbox> {
        self.inboxes.iter().find(|inbox| inbox.link_id == link_id)
    }

    /// The actor acting through the inbox a copy syncs through; see
    /// [`Self::inbox`].
    pub(crate) fn through(&self, link_id: Uuid) -> Option<Self> {
        self.inbox(link_id).map(|inbox| Self {
            inboxes: vec![inbox.clone()],
        })
    }

    /// Set `is_self` on the rows of the inbox the copy synced through
    /// `link_id` belongs to and clear it on every other row.
    pub fn mark_attendees(&self, attendees: &mut [CalendarAttendee], link_id: Uuid) {
        let inbox = self.inbox(link_id);
        for attendee in attendees {
            attendee.is_self = inbox.is_some_and(|inbox| inbox.matches(&attendee.email));
        }
    }

    /// Mark the actor's attendee rows on the copy of an event synced through
    /// `link_id` and resolve what the actor may do with it.
    pub fn mark_event(&self, event: &mut CalendarEvent, link_id: Uuid) {
        self.mark_attendees(&mut event.attendees, link_id);
        event.viewer_can = ViewerCapabilities::for_event(event, self.inbox(link_id));
    }

    /// Iterate the normalized addresses.
    pub fn iter(&self) -> impl Iterator<Item = &str> {
        self.inboxes.iter().map(|inbox| inbox.email.as_str())
    }
}

#[cfg(test)]
mod test;
