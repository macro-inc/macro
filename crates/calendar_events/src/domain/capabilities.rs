//! What a viewer may do with an event, following the organizer's guest
//! permissions and what the provider of the viewer's copy allows.

use serde::{Deserialize, Serialize};

use super::acting::OwnedInbox;
use super::models::{CalendarAttendee, CalendarEvent, CalendarProvider, EventStatus};

/// The switches an organizer sets on an event to bound what its guests may
/// do. Google omits a switch from the payload while it holds its default.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct GuestPolicy {
    /// Whether guests may change the event, including its guest list.
    pub can_modify: bool,
    /// Whether guests may invite others.
    pub can_invite_others: bool,
    /// Whether guests may see the guest list.
    pub can_see_other_guests: bool,
}

impl Default for GuestPolicy {
    /// Google's defaults: no modifying, inviting allowed, guest list visible.
    fn default() -> Self {
        Self {
            can_modify: false,
            can_invite_others: true,
            can_see_other_guests: true,
        }
    }
}

impl GuestPolicy {
    /// Whether this is Google's default policy. Kept out of serialized
    /// projections so projections stored before the policy was modeled still
    /// compare equal to fresh ones.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// The facts about one copy of an event that decide what an actor may do
/// with it.
#[derive(Clone, Copy, Debug)]
pub struct EventAccess<'a> {
    /// Whether the copy's calendar prohibits editing it.
    pub is_read_only: bool,
    /// The organizer's email.
    pub organizer_email: Option<&'a str>,
    /// The guest list the actor's relation is read from.
    pub attendees: &'a [CalendarAttendee],
    /// What the organizer lets guests do.
    pub guest_policy: GuestPolicy,
    /// Whether the copy is a snapshot of a shared meeting.
    pub is_snapshot: bool,
}

/// What the viewing requester may do with an event.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ViewerCapabilities {
    /// Change the event's details (title, time, description, conference).
    pub edit_details: bool,
    /// Add guests.
    pub invite_guests: bool,
    /// Remove guests.
    pub remove_guests: bool,
    /// Change the event's guest policy, which only Google calendars have.
    pub set_guest_policy: bool,
    /// Answer the invitation.
    pub rsvp: bool,
    /// Act as the event's organizer: replace its whole guest list and manage
    /// its conferencing.
    pub organize: bool,
}

impl ViewerCapabilities {
    /// No capability at all.
    pub const NONE: Self = Self {
        edit_details: false,
        invite_guests: false,
        remove_guests: false,
        set_guest_policy: false,
        rsvp: false,
        organize: false,
    };

    /// Whether the viewer may do nothing with the event.
    pub fn is_none(&self) -> bool {
        *self == Self::NONE
    }

    /// Resolve what the owner of `inbox`, the inbox this copy of `event`
    /// syncs through, may do with it.
    ///
    /// A read-only or cancelled event allows nothing, and neither does a
    /// snapshot of a shared meeting: its owner is listed as its only guest
    /// so the provider accepts the copy, but an answer or a guest added to
    /// it would never reach the meeting. The organizer may do
    /// everything, and so may anyone on a writable event without attendees,
    /// which is treated as the actor's own, except that only a Google copy
    /// has a guest policy to set. A guest of a Google copy follows
    /// the event's [`GuestPolicy`]: modify allows everything except changing
    /// the policy, invite allows adding guests, and every guest may answer.
    /// A guest may change the guest list only while it is visible: Google
    /// takes guest additions as a whole new list, and a guest's copy of a
    /// hidden list holds only themselves and the organizer. Outlook gives
    /// attendees no way to change the organizer's meeting, so a guest of an
    /// Outlook copy may only answer.
    ///
    /// Only the copy's own inbox counts: another of the actor's inboxes
    /// organizing or attending the event makes them nothing on this copy,
    /// which is written through this inbox's grant. `None` is an actor who
    /// does not own the copy's inbox, such as a delegate, or a teammate or
    /// channel member looking at someone else's projection; they may do
    /// nothing beyond the event-without-attendees rule. Answering always
    /// needs the inbox's own attendee row, since that is the row the answer
    /// is written to.
    pub fn for_event(event: &CalendarEvent, inbox: Option<&OwnedInbox>) -> Self {
        if event.status == EventStatus::Cancelled {
            return Self::NONE;
        }
        Self::for_access(
            EventAccess {
                is_read_only: event.is_read_only,
                organizer_email: event.organizer_email.as_deref(),
                attendees: &event.attendees,
                guest_policy: event.guest_policy,
                is_snapshot: event.is_snapshot,
            },
            inbox,
        )
    }

    /// Resolve what the owner of `inbox` may do with a live copy of an
    /// event; see [`Self::for_event`].
    pub fn for_access(access: EventAccess<'_>, inbox: Option<&OwnedInbox>) -> Self {
        if access.is_read_only || access.is_snapshot {
            return Self::NONE;
        }
        let is_guest = inbox.is_some_and(|inbox| {
            access
                .attendees
                .iter()
                .any(|attendee| inbox.matches(&attendee.email))
        });
        let is_organizer = inbox.is_some_and(|inbox| {
            access
                .organizer_email
                .is_some_and(|email| inbox.matches(email))
                || access
                    .attendees
                    .iter()
                    .any(|attendee| attendee.is_organizer && inbox.matches(&attendee.email))
        });
        if is_organizer || access.attendees.is_empty() {
            return Self {
                edit_details: true,
                invite_guests: true,
                remove_guests: true,
                set_guest_policy: inbox
                    .is_some_and(|inbox| inbox.provider == CalendarProvider::Google),
                rsvp: is_guest,
                organize: true,
            };
        }
        match inbox {
            Some(inbox) if is_guest => Self::for_guest(inbox.provider, access.guest_policy),
            _ => Self::NONE,
        }
    }

    fn for_guest(provider: CalendarProvider, policy: GuestPolicy) -> Self {
        match provider {
            CalendarProvider::Google => Self {
                edit_details: policy.can_modify,
                invite_guests: policy.can_see_other_guests
                    && (policy.can_modify || policy.can_invite_others),
                remove_guests: policy.can_see_other_guests && policy.can_modify,
                set_guest_policy: false,
                rsvp: true,
                organize: false,
            },
            CalendarProvider::Outlook => Self {
                rsvp: true,
                ..Self::NONE
            },
        }
    }
}

#[cfg(test)]
mod test;
