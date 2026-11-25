use super::*;
use crate::domain::focus::models::{FocusAnswers, FocusCategory};

fn day(month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, month, day).unwrap()
}

fn at(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339).unwrap().to_utc()
}

fn verdict(calendar_hold_until: Option<DateTime<Utc>>) -> FocusVerdict {
    FocusVerdict {
        is_focus: true,
        pinned: false,
        calendar_hold_until,
        category: FocusCategory::Known,
        needs_reply: true,
        needs_follow_up: false,
        awaiting_reply: false,
        importance: 60,
        importance_rate: 0,
    }
}

fn answers() -> FocusAnswers {
    FocusAnswers {
        focus: 0.9,
        outreach: 0.0,
        automated: 0.0,
        customer: 0.0,
        calendar_rsvp: 0.0,
        needs_decision: 0.0,
        needs_response: 0.9,
        needs_follow_up: 0.0,
        grows_with_time: 0.0,
        fades_with_time: 0.0,
    }
}

const NEW_YORK: Option<Tz> = Some(chrono_tz::America::New_York);

#[test]
fn a_due_day_begins_at_the_owners_midnight() {
    let dates = ThreadDates {
        due_on: Some(day(11, 20)),
        event_on: None,
    };

    let stored = focus_dates(
        dates,
        NEW_YORK,
        &verdict(None),
        &answers(),
        at("2026-11-17T15:00:00Z"),
        None,
    );

    assert_eq!(stored.due_on, Some(day(11, 20)));
    assert_eq!(stored.due_at, Some(at("2026-11-20T05:00:00Z")));
    assert_eq!(stored.event_over_at, None);
}

#[test]
fn with_no_zone_a_day_counts_once_it_has_begun_everywhere() {
    let dates = ThreadDates {
        due_on: Some(day(11, 20)),
        event_on: Some(day(11, 18)),
    };

    let stored = focus_dates(
        dates,
        None,
        &verdict(None),
        &answers(),
        at("2026-11-17T15:00:00Z"),
        None,
    );

    assert_eq!(stored.due_at, Some(at("2026-11-20T12:00:00Z")));
    // A deadline after the meeting outlasts it.
    assert_eq!(stored.event_over_at, None);
}

#[test]
fn a_meeting_is_over_when_the_owners_next_day_begins() {
    let dates = ThreadDates {
        due_on: None,
        event_on: Some(day(11, 18)),
    };

    let in_new_york = focus_dates(
        dates,
        NEW_YORK,
        &verdict(None),
        &answers(),
        at("2026-11-17T15:00:00Z"),
        None,
    );
    let anywhere = focus_dates(
        dates,
        None,
        &verdict(None),
        &answers(),
        at("2026-11-17T15:00:00Z"),
        None,
    );

    assert_eq!(in_new_york.event_over_at, Some(at("2026-11-19T05:00:00Z")));
    assert_eq!(anywhere.event_over_at, Some(at("2026-11-19T12:00:00Z")));
}

#[test]
fn a_deadline_up_to_the_meeting_lets_the_meeting_decide() {
    let dates = ThreadDates {
        due_on: Some(day(11, 16)),
        event_on: Some(day(11, 18)),
    };

    let stored = focus_dates(
        dates,
        NEW_YORK,
        &verdict(None),
        &answers(),
        at("2026-11-13T15:00:00Z"),
        None,
    );

    assert_eq!(stored.due_at, Some(at("2026-11-16T05:00:00Z")));
    assert_eq!(stored.event_over_at, Some(at("2026-11-19T05:00:00Z")));

    // A deadline on the meeting's own day is the meeting's preparation.
    let same_day = ThreadDates {
        due_on: Some(day(11, 18)),
        event_on: Some(day(11, 18)),
    };
    let stored = focus_dates(
        same_day,
        NEW_YORK,
        &verdict(None),
        &answers(),
        at("2026-11-13T15:00:00Z"),
        None,
    );
    assert_eq!(stored.event_over_at, Some(at("2026-11-19T05:00:00Z")));

    // One after it outlasts the meeting.
    let after = ThreadDates {
        due_on: Some(day(11, 20)),
        event_on: Some(day(11, 18)),
    };
    let stored = focus_dates(
        after,
        NEW_YORK,
        &verdict(None),
        &answers(),
        at("2026-11-13T15:00:00Z"),
        None,
    );
    assert_eq!(stored.due_at, Some(at("2026-11-20T05:00:00Z")));
    assert_eq!(stored.event_over_at, None);
}

#[test]
fn a_calendar_change_keeps_its_own_hold() {
    let dates = ThreadDates {
        due_on: None,
        event_on: Some(day(11, 18)),
    };
    let held = verdict(Some(at("2026-11-18T16:00:00Z")));

    let stored = focus_dates(
        dates,
        NEW_YORK,
        &held,
        &answers(),
        at("2026-11-17T15:00:00Z"),
        None,
    );

    assert_eq!(stored.event_over_at, None);
}

#[test]
fn mail_after_a_meeting_that_owes_nothing_lets_the_thread_go_at_once() {
    let dates = ThreadDates {
        due_on: None,
        event_on: Some(day(11, 18)),
    };
    let notes = FocusVerdict {
        needs_reply: false,
        ..verdict(None)
    };

    // Written late on the 18th in a zone west of the owner's, after their day ended.
    let stored = focus_dates(
        dates,
        NEW_YORK,
        &notes,
        &answers(),
        at("2026-11-19T06:00:00Z"),
        None,
    );

    assert_eq!(stored.event_over_at, Some(at("2026-11-19T05:00:00Z")));
}

#[test]
fn mail_more_than_two_weeks_after_a_meeting_is_about_something_else() {
    let dates = ThreadDates {
        due_on: None,
        event_on: Some(day(11, 18)),
    };
    let notes = FocusVerdict {
        needs_reply: false,
        ..verdict(None)
    };
    // The day the latest message was written on, by the calendar the read counts
    // it by, even for one the read never saw (an attachment with no text),
    // measures how far past the meeting the thread has gone. The hour of the
    // owner's clock doesn't: it is one instant either way.
    let latest_at = at("2026-12-02T12:00:00Z");
    let stored_on = |written_on| {
        focus_dates(
            dates,
            NEW_YORK,
            &notes,
            &answers(),
            latest_at,
            Some(written_on),
        )
    };

    // 2026-12-02 is the 14th day after the meeting; 12-03 the 15th.
    assert_eq!(
        stored_on(day(12, 2)).event_over_at,
        Some(at("2026-11-19T05:00:00Z"))
    );
    assert_eq!(stored_on(day(12, 3)).event_over_at, None);
}

#[test]
fn mail_after_a_meeting_that_owes_an_answer_is_judged_on_its_own() {
    let dates = ThreadDates {
        due_on: None,
        event_on: Some(day(11, 18)),
    };
    let written = at("2026-11-19T06:00:00Z");

    // A question to the owner.
    let asks = focus_dates(dates, NEW_YORK, &verdict(None), &answers(), written, None);
    // The owner's own question, still waiting.
    let waits = FocusVerdict {
        needs_reply: false,
        awaiting_reply: true,
        ..verdict(None)
    };
    let waiting = focus_dates(dates, NEW_YORK, &waits, &answers(), written, None);
    // The owner's, with a loop to close.
    let open = FocusVerdict {
        needs_reply: false,
        needs_follow_up: true,
        ..verdict(None)
    };
    let open_loop = focus_dates(dates, NEW_YORK, &open, &answers(), written, None);
    // A decision, approval or signature only the owner can give, with no reply asked.
    let notes = FocusVerdict {
        needs_reply: false,
        ..verdict(None)
    };
    let approval = FocusAnswers {
        needs_decision: 0.8,
        needs_response: 0.0,
        ..answers()
    };
    let decision = focus_dates(dates, NEW_YORK, &notes, &approval, written, None);

    assert_eq!(asks.event_over_at, None);
    assert_eq!(waiting.event_over_at, None);
    assert_eq!(open_loop.event_over_at, None);
    assert_eq!(decision.event_over_at, None);

    // Before the meeting is over, the meeting decides either way.
    let before = focus_dates(
        dates,
        NEW_YORK,
        &verdict(None),
        &answers(),
        at("2026-11-17T15:00:00Z"),
        None,
    );
    assert_eq!(before.event_over_at, Some(at("2026-11-19T05:00:00Z")));
}

#[test]
fn a_day_whose_midnight_is_skipped_begins_at_its_first_hour() {
    // Clocks in Santiago jump from midnight to 01:00 on 2026-09-06.
    let santiago = Some(chrono_tz::America::Santiago);
    let dates = ThreadDates {
        due_on: Some(day(9, 6)),
        event_on: None,
    };

    let stored = focus_dates(
        dates,
        santiago,
        &verdict(None),
        &answers(),
        at("2026-09-01T15:00:00Z"),
        None,
    );

    assert_eq!(stored.due_at, Some(at("2026-09-06T04:00:00Z")));
}
