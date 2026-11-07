//! What a message's saved calendar content and subject say about an event.

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};

use super::models::{CalendarNotice, CalendarPart, FocusMessage};
use crate::domain::models::calendar_invitation::{
    CalendarInvitation, InvitationDateTime, InvitationMethod,
};

/// Days a change holds a thread when nothing says when its event is over: a
/// series goes on past any one date, and a subject names no usable time.
const FALLBACK_HOLD_DAYS: i64 = 7;
/// Hours after midnight UTC by which a date has begun everywhere on Earth. An
/// all-day event carries no zone, so its end date only counts once it has.
const DATE_BEGUN_EVERYWHERE_HOURS: i64 = 12;

/// Subject prefixes Google Calendar, Outlook and scheduling tools put on updates,
/// reschedules, cancellations and proposed new times.
const CHANGE_PREFIXES: [&str; 13] = [
    "updated invitation",
    "updated invitation with note",
    "canceled",
    "cancelled",
    "canceled event",
    "cancelled event",
    "canceled event with note",
    "event updated",
    "rescheduled",
    "event rescheduled",
    "meeting rescheduled",
    "proposed new time",
    "new time proposed",
];

/// Subject prefixes on first invitations.
const NEW_INVITE_PREFIXES: [&str; 2] = ["invitation", "new event"];

/// Subject prefixes on attendees' RSVP notices.
const RSVP_PREFIXES: [&str; 4] = ["accepted", "declined", "tentative", "tentatively accepted"];

fn has_subject_prefix(subject: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| {
        subject
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.trim_start().starts_with(':'))
    })
}

/// A Postgres regular expression matching a lowercased subject with a change
/// prefix, so the sweep looks for what [`notice_in_subject`] reads.
pub fn change_subject_pattern() -> String {
    format!(r"^({})\s*:", CHANGE_PREFIXES.join("|"))
}

fn fallback_hold(at: DateTime<Utc>) -> DateTime<Utc> {
    at + Duration::days(FALLBACK_HOLD_DAYS)
}

/// The calendar notice a subject reads as, e.g. "Accepted: Demo @ Fri" is an
/// RSVP. A change holds until `change_until`.
fn notice_in_subject(subject: &str, change_until: DateTime<Utc>) -> Option<CalendarNotice> {
    let subject = subject.to_lowercase();
    if has_subject_prefix(&subject, &RSVP_PREFIXES) {
        Some(CalendarNotice::Rsvp)
    } else if has_subject_prefix(&subject, &CHANGE_PREFIXES) {
        Some(CalendarNotice::Change {
            until: change_until,
        })
    } else if has_subject_prefix(&subject, &NEW_INVITE_PREFIXES) {
        Some(CalendarNotice::NewInvite)
    } else {
        None
    }
}

/// The calendar notice one message is. A saved change or RSVP decides. Otherwise
/// the subject does, since not every tool bumps an event's sequence when it
/// changes, and a calendar file that says nothing more is a new invite.
pub(super) fn notice_in_message(message: &FocusMessage) -> Option<CalendarNotice> {
    let from_subject = |change_until| {
        message
            .subject
            .as_deref()
            .and_then(|subject| notice_in_subject(subject, change_until))
    };
    let fallback = fallback_hold(message.at);
    match message.calendar_part {
        Some(CalendarPart::Change { until }) => Some(CalendarNotice::Change { until }),
        Some(CalendarPart::Rsvp) => Some(CalendarNotice::Rsvp),
        Some(CalendarPart::NewInvite { until }) => {
            from_subject(until).or(Some(CalendarNotice::NewInvite))
        }
        Some(CalendarPart::Unparsed) => from_subject(fallback).or(Some(CalendarNotice::NewInvite)),
        None => from_subject(fallback),
    }
}

fn is_change(invite: &CalendarInvitation) -> bool {
    match invite.method {
        InvitationMethod::Cancel | InvitationMethod::Counter => true,
        InvitationMethod::Request => invite.sequence > 0,
        InvitationMethod::Reply | InvitationMethod::Publish | InvitationMethod::Unknown => false,
    }
}

fn start_of_date(value: &str) -> Option<DateTime<Utc>> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    Some(date.and_time(NaiveTime::MIN).and_utc() + Duration::hours(DATE_BEGUN_EVERYWHERE_HOURS))
}

fn instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|at| at.to_utc())
}

/// When an event is over: its end, else its start. An end date is exclusive, and
/// an all-day start with no end lasts that day.
fn event_over_at(invite: &CalendarInvitation) -> Option<DateTime<Utc>> {
    let end = invite.end.as_ref().and_then(|end| match end {
        InvitationDateTime::Zoned { value, .. } => instant(value),
        InvitationDateTime::Date { value } => start_of_date(value),
        InvitationDateTime::Unresolved { .. } => None,
    });
    end.or_else(|| {
        invite.start.as_ref().and_then(|start| match start {
            InvitationDateTime::Zoned { value, .. } => instant(value),
            InvitationDateTime::Date { value } => {
                start_of_date(value).map(|at| at + Duration::days(1))
            }
            InvitationDateTime::Unresolved { .. } => None,
        })
    })
}

/// How long a change holds a thread that received it at `at`. Only a single
/// event has one end. `recurrence` is `None` on snapshots saved before it was
/// recorded, which may hide a series, so those wait the fixed while too.
fn change_hold(invite: &CalendarInvitation, at: DateTime<Utc>) -> DateTime<Utc> {
    invite
        .recurrence
        .as_ref()
        .filter(|lines| lines.is_empty())
        .and_then(|_| event_over_at(invite))
        .unwrap_or_else(|| fallback_hold(at))
}

impl CalendarPart {
    /// What the saved components of a message received at `at` say, if it has
    /// any. Any change makes it one, held until the last changed event is over.
    pub fn from_saved(invites: &[CalendarInvitation], at: DateTime<Utc>) -> Option<Self> {
        let hold = |invite: &CalendarInvitation| change_hold(invite, at);
        if let Some(until) = invites
            .iter()
            .filter(|invite| is_change(invite))
            .map(hold)
            .max()
        {
            return Some(Self::Change { until });
        }
        let until = invites.iter().map(hold).max()?;
        let only_replies = invites
            .iter()
            .all(|invite| invite.method == InvitationMethod::Reply);
        Some(if only_replies {
            Self::Rsvp
        } else {
            Self::NewInvite { until }
        })
    }
}

#[cfg(test)]
mod test;
