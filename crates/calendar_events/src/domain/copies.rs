//! Which copy of a meeting an agent changes when the meeting is on several of
//! the user's own inboxes. Each inbox holds its own copy, and a change to the
//! details, the guests or the guest permissions, or a deletion, reaches the
//! meeting differently from each, so an agent must name the copy's inbox
//! instead of picking one.
use std::collections::HashSet;

use uuid::Uuid;

use super::models::MeetingCopy;

/// A change that reaches a meeting differently depending on which of the
/// user's copies makes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CopyChange {
    /// Details, guest permissions or the guest list; `changes_guests` when
    /// the change carries a guest list, which may invite or remove guests.
    Update {
        /// Whether the change carries a guest list.
        changes_guests: bool,
    },
    /// Adding guests without touching anyone already invited.
    InviteGuests,
    /// Deleting the copy.
    Delete,
}

/// Why a change was refused until the caller names the copy's inbox: what
/// to tell the user, listing each copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CopyRefusal {
    message: String,
}

impl CopyRefusal {
    /// The explanation to relay, naming each copy's inbox, role and id.
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// Check that a change to `event_id` names the copy it means when the
/// meeting is on several of the user's inboxes. With `inbox` set, it must be
/// the inbox holding the addressed copy; without it, a copy that is one of
/// several inboxes' copies is refused, listing each, so the caller asks the
/// user. A copy outside `copies`, such as one held through a delegated inbox,
/// has no siblings to tell apart and passes.
pub fn check_copy(
    copies: &[MeetingCopy],
    event_id: Uuid,
    inbox: Option<&str>,
    change: CopyChange,
) -> Option<CopyRefusal> {
    let addressed = copies.iter().find(|copy| copy.event_id == event_id)?;
    if let Some(inbox) = inbox.map(str::trim) {
        if addressed.inbox.eq_ignore_ascii_case(inbox) {
            return None;
        }
        let other = copies
            .iter()
            .find(|copy| copy.inbox.eq_ignore_ascii_case(inbox))
            .map(|copy| format!(" The copy on {inbox} is eventId {}.", copy.event_id))
            .unwrap_or_default();
        return Some(CopyRefusal {
            message: format!(
                "`inbox` {inbox} does not hold this copy: eventId {event_id} is the copy on \
                 {}.{other}",
                addressed.inbox
            ),
        });
    }
    let inboxes: HashSet<String> = copies
        .iter()
        .map(|copy| copy.inbox.to_lowercase())
        .collect();
    if inboxes.len() < 2 {
        return None;
    }
    Some(CopyRefusal {
        message: copy_question(copies, inboxes.len(), change),
    })
}

/// What the caller needs to ask which copy to change: each copy's inbox,
/// role and id, what the change would do from each, and the question to put
/// to the user word for word.
fn copy_question(copies: &[MeetingCopy], inboxes: usize, change: CopyChange) -> String {
    let listed = copies
        .iter()
        .map(|copy| {
            let role = if copy.organizes {
                "organizes it"
            } else if copy.attends {
                "is a guest"
            } else {
                "holds a copy"
            };
            format!("{} {role} (eventId {})", copy.inbox, copy.event_id)
        })
        .collect::<Vec<_>>()
        .join("; ");
    let (effect, verb) = match change {
        CopyChange::Delete => (
            "Deleting the copy an inbox organizes cancels the meeting for every guest, while \
             deleting a guest's copy takes it off that inbox's calendar and, on Google, also \
             declines the invitation and tells the organizer."
                .to_string(),
            "delete",
        ),
        CopyChange::InviteGuests => match copies.iter().find(|copy| copy.organizes) {
            Some(organizer) => (
                format!(
                    "To add guests, suggest {}: it organizes the meeting, so they are invited \
                     directly, while a guest's copy can invite only where the organizer allows \
                     it.",
                    organizer.inbox
                ),
                "add the guests from",
            ),
            None => (
                "A guest's copy can invite only where the organizer allows it.".to_string(),
                "add the guests from",
            ),
        },
        CopyChange::Update { changes_guests } => match copies.iter().find(|copy| copy.organizes) {
            Some(organizer) if changes_guests => (
                format!(
                    "To change the guest list, suggest {}: it organizes the meeting, so it \
                         can invite and remove guests, while a guest's copy can only invite, \
                         and only where the organizer allows it.",
                    organizer.inbox
                ),
                "change the guests on",
            ),
            _ => (
                "The change reaches the meeting differently from each copy, and a guest's \
                     copy can only make it where the organizer allows it."
                    .to_string(),
                "change",
            ),
        },
    };
    let organizer_first = matches!(
        change,
        CopyChange::InviteGuests
            | CopyChange::Update {
                changes_guests: true
            }
    );
    let question = format!(
        "Which inbox's copy should I {verb}: {}?",
        choices(copies, organizer_first)
    );
    format!(
        "This meeting is on {inboxes} of the user's inboxes: {listed}. {effect} Never choose \
         between the user's inboxes yourself, whatever they look like. Once the user answers, \
         call again with the chosen copy's `eventId` and its inbox as `inbox`. Ask the user \
         exactly this and wait for the answer: \"{question}\""
    )
}

/// Each inbox once, with its role, as "a (organizer), b (guest) or c
/// (guest)"; the organizing inbox leads when it is the one to suggest.
fn choices(copies: &[MeetingCopy], organizer_first: bool) -> String {
    let mut ordered = copies.iter().collect::<Vec<_>>();
    if organizer_first {
        ordered.sort_by_key(|copy| !copy.organizes);
    }
    let mut seen = HashSet::new();
    let options = ordered
        .into_iter()
        .filter(|copy| seen.insert(copy.inbox.to_lowercase()))
        .map(|copy| {
            if copy.organizes {
                format!("{} (organizer)", copy.inbox)
            } else if copy.attends {
                format!("{} (guest)", copy.inbox)
            } else {
                copy.inbox.clone()
            }
        })
        .collect::<Vec<_>>();
    match options.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} or {last}", rest.join(", ")),
        _ => options.join(""),
    }
}

#[cfg(test)]
mod test;
