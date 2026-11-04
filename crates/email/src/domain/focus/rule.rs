//! The deterministic rule that turns Jev's answers into a Focus verdict.

use super::models::{CalendarNotice, FocusAnswers, FocusCategory, FocusSignals, FocusVerdict};

/// The rule's version, stored with each verdict. Bump it when [`decide`] or the
/// signals change: the next sweep re-decides rows stored under an older version
/// from their stored answers, without asking Jev again.
pub const FOCUS_RULE_VERSION: i16 = 1;

/// A "yes" from Jev.
const YES: f32 = 0.5;
/// The lower Focus bar for threads from people the owner corresponds with.
const CONTACT_FOCUS: f32 = 0.3;
/// The higher Focus bar for unsolicited outreach from strangers. Only a
/// profile that asks for such mail (a recruiter's applications) clears it;
/// on the experiment's founder inbox no stranger outreach scored above 0.5.
const OUTREACH_FOCUS: f32 = 0.6;
/// Jev's calendar answer only counts when it is this sure; below it, it
/// flagged real conversations that merely mentioned an invite.
const CALENDAR: f32 = 0.7;
/// The bar for the reply-needed and follow-up flags. With the owner's memory
/// as context Jev leans towards "yes", so a plain yes flagged half of Focus.
const FLAG: f32 = 0.7;

/// Subject prefixes Google Calendar, Outlook and scheduling tools put on
/// invites, updates, reschedules and cancellations.
const SCHEDULING_PREFIXES: [&str; 15] = [
    "invitation",
    "updated invitation",
    "updated invitation with note",
    "canceled",
    "cancelled",
    "canceled event",
    "cancelled event",
    "canceled event with note",
    "new event",
    "event updated",
    "rescheduled",
    "event rescheduled",
    "meeting rescheduled",
    "proposed new time",
    "new time proposed",
];

/// Subject prefixes on attendees' RSVP notices.
const RSVP_PREFIXES: [&str; 4] = ["accepted", "declined", "tentative", "tentatively accepted"];

/// Importance weights. A thread needs a reply or a follow-up, never both, so the
/// largest score is 1.
const WEIGHT_FOCUS: f32 = 0.55;
const WEIGHT_REPLY: f32 = 0.25;
const WEIGHT_FOLLOW_UP: f32 = 0.15;
const WEIGHT_DECISION: f32 = 0.10;
const WEIGHT_CONTACT: f32 = 0.10;

/// Lowest importance by why a thread is in Focus: mail in for a reason Jev's
/// relevance score doesn't measure must not read as unimportant.
const REPLY_FLOOR: u8 = 70;
const FOLLOW_UP_FLOOR: u8 = 55;
const KEY_FLOOR: u8 = 50;
const FOCUS_FLOOR: u8 = 30;

fn has_subject_prefix(subject: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| {
        subject
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.trim_start().starts_with(':'))
    })
}

/// The calendar notice a subject reads as, e.g. "Accepted: Demo @ Fri" is an RSVP.
pub(super) fn calendar_notice_in_subject(subject: &str) -> Option<CalendarNotice> {
    let subject = subject.to_lowercase();
    if has_subject_prefix(&subject, &RSVP_PREFIXES) {
        return Some(CalendarNotice::Rsvp);
    }
    has_subject_prefix(&subject, &SCHEDULING_PREFIXES).then_some(CalendarNotice::Scheduling)
}

/// Decide whether a thread belongs in Focus, why, and how important it is.
///
/// Key mail is always in: invites, updates, reschedules and cancellations, mail
/// waiting on the owner's reply, and mail from recent contacts, unless it is
/// outreach, automated, or from someone the owner turned away. RSVP notices are
/// always out. Everything else is in when Jev says the owner, as their profile
/// describes them, would want it, unless it is automated mail nobody vouches
/// for. Unsolicited outreach from strangers needs a firmer yes. Customers, and
/// contacts Jev finds at least somewhat relevant, need less, unless the mail is
/// outreach.
///
/// A thread the owner is waiting on joins Focus once it has waited long enough;
/// the list applies that age when it reads, since nothing reclassifies a thread
/// as it ages. Its category and importance are set for that moment here.
pub fn decide(answers: &FocusAnswers, signals: &FocusSignals) -> FocusVerdict {
    // Jev's one calendar question covers invites, updates and RSVPs alike, so
    // alone it can only say "scheduling notice": never drop a reschedule.
    let notice = signals
        .calendar
        .or((answers.calendar_rsvp >= CALENDAR).then_some(CalendarNotice::Scheduling));
    let scheduling = notice == Some(CalendarNotice::Scheduling);
    let rsvp = notice == Some(CalendarNotice::Rsvp);

    let customer = answers.customer >= YES;
    let outreach = answers.outreach >= YES;
    let reads_automated = answers.automated >= YES;
    let vouched = signals.contact && answers.focus >= YES;
    let automated = reads_automated && !customer && !signals.replied && !vouched;
    let stranger = !signals.contact && !signals.replied;
    let focus_bar = if outreach && stranger {
        OUTREACH_FOCUS
    } else {
        YES
    };
    let earned = !automated
        && (answers.focus >= focus_bar
            || (!outreach && (customer || (signals.contact && answers.focus >= CONTACT_FOCUS))));

    let asks_owner = !signals.latest_from_owner && answers.needs_response >= FLAG;
    let key_sender = !outreach && !reads_automated && !signals.brushed_off;
    let pinned = scheduling || (!rsvp && key_sender && (asks_owner || signals.recent_contact));
    let is_focus = !rsvp && (pinned || earned);

    // Who wrote last settles the label, whichever way Jev flagged the thread:
    // nobody follows up on mail still waiting on the owner's own answer.
    let open_loop = answers.needs_follow_up >= FLAG;
    let needs_reply = is_focus && !signals.latest_from_owner && (asks_owner || open_loop);
    let needs_follow_up = is_focus && signals.latest_from_owner && open_loop;

    let category = if notice.is_some() {
        FocusCategory::Calendar
    } else if is_focus || signals.awaiting_reply {
        if customer {
            FocusCategory::Customer
        } else if signals.teammate {
            FocusCategory::Team
        } else if signals.contact {
            FocusCategory::Known
        } else {
            FocusCategory::Other
        }
    } else if outreach {
        FocusCategory::Outreach
    } else if automated {
        FocusCategory::Automated
    } else {
        FocusCategory::LowRelevance
    };

    let score = WEIGHT_FOCUS * answers.focus
        + WEIGHT_REPLY * f32::from(u8::from(needs_reply))
        + WEIGHT_FOLLOW_UP * f32::from(u8::from(needs_follow_up))
        + WEIGHT_DECISION * f32::from(u8::from(answers.needs_decision >= YES))
        + WEIGHT_CONTACT * f32::from(u8::from(signals.contact));
    let floor = if needs_reply {
        REPLY_FLOOR
    } else if needs_follow_up || signals.awaiting_reply {
        FOLLOW_UP_FLOOR
    } else if pinned || (is_focus && customer) {
        KEY_FLOOR
    } else if is_focus {
        FOCUS_FLOOR
    } else {
        0
    };
    // Answers are probabilities, so the score already sits in 0..=1.
    let importance = ((score.clamp(0.0, 1.0) * 100.0).round() as u8).max(floor);

    FocusVerdict {
        is_focus,
        pinned,
        category,
        needs_reply,
        needs_follow_up,
        awaiting_reply: signals.awaiting_reply,
        importance,
    }
}

#[cfg(test)]
mod test;
