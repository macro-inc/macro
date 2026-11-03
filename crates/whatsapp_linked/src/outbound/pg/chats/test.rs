use super::*;
use chrono::TimeZone;

fn anchor(id: &str, minute: u32) -> MessageAnchor {
    MessageAnchor {
        id: id.to_owned(),
        at: Utc.with_ymd_and_hms(2026, 10, 1, 12, minute, 0).unwrap(),
        from_me: false,
        sender_jid: None,
    }
}

fn page(messages: u32, oldest: Option<MessageAnchor>, complete: bool) -> HistoryPage {
    HistoryPage {
        chat_jid: "120363000000000001@g.us".to_owned(),
        messages,
        oldest,
        complete,
    }
}

#[test]
fn pages_move_the_cursor_back_until_the_phone_has_nothing_older() {
    let adopted = Utc.with_ymd_and_hms(2026, 10, 2, 0, 0, 0).unwrap();
    let (imported, cursor, state) =
        after_page(&page(50, Some(anchor("b", 30)), false), 0, None, adopted);
    assert_eq!(
        (imported, cursor.clone(), state),
        (50, Some(anchor("b", 30)), BackfillState::Running)
    );
    let (_, _, state) = after_page(&page(3, Some(anchor("a", 10)), true), 50, cursor, adopted);
    assert_eq!(state, BackfillState::Done);
}

#[test]
fn the_message_limit_and_age_limit_stop_as_partial() {
    let adopted = Utc.with_ymd_and_hms(2026, 10, 2, 0, 0, 0).unwrap();
    let (_, _, state) = after_page(
        &page(50, Some(anchor("b", 30)), false),
        BACKFILL_MESSAGE_LIMIT - 10,
        None,
        adopted,
    );
    assert_eq!(state, BackfillState::Partial);
    let long_ago = Utc.with_ymd_and_hms(2027, 3, 1, 0, 0, 0).unwrap();
    let (_, _, state) = after_page(&page(50, Some(anchor("b", 30)), false), 0, None, long_ago);
    assert_eq!(state, BackfillState::Partial);
}

#[test]
fn a_page_that_does_not_go_further_back_ends_the_import() {
    let adopted = Utc.with_ymd_and_hms(2026, 10, 2, 0, 0, 0).unwrap();
    let (_, cursor, state) = after_page(
        &page(5, Some(anchor("b", 30)), false),
        50,
        Some(anchor("a", 10)),
        adopted,
    );
    assert_eq!(
        (cursor, state),
        (Some(anchor("a", 10)), BackfillState::Done)
    );
}
