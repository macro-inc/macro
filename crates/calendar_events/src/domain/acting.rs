//! The clicker's owned inboxes.

use super::models::CalendarAttendee;

/// The clicker's own connected-inbox addresses.
///
/// These are the attendee rows the user may RSVP as, and the rows a viewer
/// sees marked as `(you)`. The set is non-empty, lowercased, and
/// deduplicated. Constructors only accept addresses from inboxes the
/// requester owns (`email_links.macro_id = requester`), so a calendar
/// owner's address cannot enter this type unless the clicker owns that
/// inbox too.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActorInboxes {
    emails: Vec<String>,
}

impl ActorInboxes {
    /// Normalize the requester's owned inbox addresses.
    ///
    /// Returns `None` when the requester owns no connected inbox. RSVP
    /// treats that as [`super::ports::CalendarMutationError::NotAttendee`].
    /// Display leaves provider `is_self` flags untouched.
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

    /// A single-address actor for fixtures.
    #[cfg(test)]
    pub(crate) fn sole(email: impl Into<String>) -> Self {
        Self {
            emails: vec![email.into().to_ascii_lowercase()],
        }
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

#[cfg(test)]
mod test;
