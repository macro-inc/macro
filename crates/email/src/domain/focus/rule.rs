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
/// The bar for the reply-needed and follow-up flags. With the owner's memory
/// as context Jev leans towards "yes", so a plain yes flagged half of Focus.
const FLAG: f32 = 0.7;

/// A new invite is out of Focus, like an RSVP. Set this to false and a new invite
/// takes the normal rule instead, as an ordinary thread.
const NEW_INVITES_STAY_OUT: bool = true;

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

/// Decide whether a thread belongs in Focus, why, and how important it is.
///
/// Key mail is always in: mail waiting on the owner's reply, and mail from recent
/// contacts, unless it is outreach, automated, or from someone the owner turned
/// away. Everything else is in when Jev says the owner, as their profile describes
/// them, would want it, unless it is automated mail nobody vouches for. Unsolicited
/// outreach from strangers needs a firmer yes. Customers, and contacts Jev finds at
/// least somewhat relevant, need less, unless the mail is outreach.
///
/// Calendar mail counts only when it is the thread's latest message; once anyone
/// has written after it, the thread is a conversation like any other. A change (a
/// reschedule, update, cancellation or proposed new time) is held in Focus until
/// its event is over, whatever else it reads as. A new invite and an RSVP are out.
/// Jev's calendar answer plays no part: it can't tell these apart, so a thread only
/// Jev calls calendar mail takes the rules above and reads as its sender's category.
///
/// Time is not known here, so `is_focus` leaves out what time decides. A thread the
/// owner is waiting on joins Focus once it has waited long enough, and a calendar
/// change holds one until `calendar_hold_until`; the list applies both when it
/// reads, since nothing reclassifies a thread as it ages. Its labels and importance
/// are set for those moments here, and the read calls a held thread Calendar, so
/// Calendar in Focus only ever means a change still ahead of its event.
pub fn decide(answers: &FocusAnswers, signals: &FocusSignals) -> FocusVerdict {
    let calendar_hold_until = signals.calendar_change_until();
    let left_out = match signals.calendar {
        Some(CalendarNotice::Rsvp) => true,
        Some(CalendarNotice::NewInvite) => NEW_INVITES_STAY_OUT,
        Some(CalendarNotice::Change { .. }) | None => false,
    };

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
    let pinned = !left_out && key_sender && (asks_owner || signals.recent_contact);
    let is_focus = !left_out && (pinned || earned);
    let in_focus_while_held = is_focus || calendar_hold_until.is_some();

    // Who wrote last settles the label, whichever way Jev flagged the thread:
    // nobody follows up on mail still waiting on the owner's own answer.
    let open_loop = answers.needs_follow_up >= FLAG;
    let needs_reply =
        in_focus_while_held && !signals.latest_from_owner && (asks_owner || open_loop);
    let needs_follow_up = in_focus_while_held && signals.latest_from_owner && open_loop;

    let category = if left_out {
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
    } else if pinned || calendar_hold_until.is_some() || (is_focus && customer) {
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
        calendar_hold_until,
        category,
        needs_reply,
        needs_follow_up,
        awaiting_reply: signals.awaiting_reply,
        importance,
    }
}

#[cfg(test)]
mod test;
