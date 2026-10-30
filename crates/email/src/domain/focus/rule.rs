//! The deterministic rule that turns Jev's answers into a Focus verdict.

use super::models::{FocusAnswers, FocusCategory, FocusSignals, FocusVerdict};

/// A "yes" from Jev.
const YES: f32 = 0.5;
/// The lower Focus bar for threads from people the owner corresponds with.
const CONTACT_FOCUS: f32 = 0.3;
/// The higher Focus bar for unsolicited outreach from strangers. Only a
/// profile that asks for such mail (a recruiter's applications) clears it;
/// on the experiment's founder inbox no stranger outreach scored above 0.5.
const OUTREACH_FOCUS: f32 = 0.6;
/// Jev's calendar answer only vetoes a thread when it is this sure; below it,
/// it flagged real conversations that merely mentioned an invite.
const CALENDAR: f32 = 0.7;
/// The bar for the reply-needed and follow-up flags. With the owner's memory
/// as context Jev leans towards "yes", so a plain yes flagged half of Focus.
const FLAG: f32 = 0.7;

/// Subject prefixes Google Calendar and Outlook put on invites and RSVPs.
const CALENDAR_PREFIXES: [&str; 10] = [
    "accepted",
    "declined",
    "tentatively accepted",
    "invitation",
    "updated invitation",
    "updated invitation with note",
    "canceled",
    "canceled event",
    "new event",
    "event updated",
];

/// Importance weights; they sum to 1.
const WEIGHT_FOCUS: f32 = 0.55;
const WEIGHT_REPLY: f32 = 0.15;
const WEIGHT_FOLLOW_UP: f32 = 0.10;
const WEIGHT_DECISION: f32 = 0.10;
const WEIGHT_CONTACT: f32 = 0.10;

/// Whether a subject is a calendar invite or RSVP, e.g. "Accepted: Demo @ Fri".
pub fn is_calendar_subject(subject: &str) -> bool {
    let subject = subject.to_lowercase();
    CALENDAR_PREFIXES.iter().any(|prefix| {
        subject
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.trim_start().starts_with(':'))
    })
}

/// Decide whether a thread belongs in Focus, why, and how important it is.
///
/// A thread is left out when it is a calendar notice or automated mail nobody
/// vouches for. Otherwise it is in when Jev says the owner, as their profile
/// describes them, would want it. Unsolicited outreach from strangers needs a
/// firmer yes. Customers, and contacts Jev finds at least somewhat relevant,
/// need less, unless the mail is outreach.
pub fn decide(answers: &FocusAnswers, signals: &FocusSignals) -> FocusVerdict {
    let calendar = signals.calendar_subject || answers.calendar_rsvp >= CALENDAR;
    let customer = answers.customer >= YES;
    let outreach = answers.outreach >= YES;
    let vouched = signals.contact && answers.focus >= YES;
    let automated = answers.automated >= YES && !customer && !signals.replied && !vouched;
    let stranger = !signals.contact && !signals.replied;
    let focus_bar = if outreach && stranger {
        OUTREACH_FOCUS
    } else {
        YES
    };

    let is_focus = !calendar
        && !automated
        && (answers.focus >= focus_bar
            || (!outreach && (customer || (signals.contact && answers.focus >= CONTACT_FOCUS))));
    let needs_reply = is_focus && !signals.latest_from_owner && answers.needs_response >= FLAG;
    let needs_follow_up = is_focus && answers.needs_follow_up >= FLAG;

    let category = if is_focus {
        if customer {
            FocusCategory::Customer
        } else if signals.teammate {
            FocusCategory::Team
        } else if signals.contact {
            FocusCategory::Known
        } else {
            FocusCategory::Other
        }
    } else if calendar {
        FocusCategory::Calendar
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
    // Answers are probabilities, so the score already sits in 0..=1.
    let importance = (score.clamp(0.0, 1.0) * 100.0).round() as u8;

    FocusVerdict {
        is_focus,
        category,
        needs_reply,
        needs_follow_up,
        importance,
    }
}

#[cfg(test)]
mod test;
