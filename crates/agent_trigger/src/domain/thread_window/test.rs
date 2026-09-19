use super::*;

use chrono::TimeZone as _;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;

fn thread(len: u128) -> Vec<ThreadMessage> {
    (0..len)
        .map(|index| ThreadMessage {
            id: Uuid::from_u128(index),
            sender: ChannelSender::new_from_user(
                MacroUserIdStr::parse_from_str("macro|thread-window-test@macro.com")
                    .expect("a valid user id")
                    .into_owned(),
            ),
            content: format!("message {index}"),
            created_at: Utc
                .timestamp_opt(1_700_000_000 + index as i64, 0)
                .single()
                .expect("a valid timestamp"),
        })
        .collect()
}

fn anchors(indices: &[u128]) -> Vec<Uuid> {
    indices
        .iter()
        .map(|index| Uuid::from_u128(*index))
        .collect()
}

fn ids(entries: &[TranscriptEntry<'_>]) -> Vec<u128> {
    entries
        .iter()
        .filter_map(|entry| match entry {
            TranscriptEntry::Message(message) => Some(message.id.as_u128()),
            TranscriptEntry::Elided { .. } => None,
        })
        .collect()
}

fn elisions(entries: &[TranscriptEntry<'_>]) -> Vec<usize> {
    entries
        .iter()
        .filter_map(|entry| match entry {
            TranscriptEntry::Elided { count } => Some(*count),
            TranscriptEntry::Message(_) => None,
        })
        .collect()
}

#[test]
fn a_thread_with_no_anchors_yields_nothing() {
    let messages = thread(10);

    assert!(thread_window(&messages, &[], 2, 60).is_empty());
}

#[test]
fn an_anchor_that_is_not_in_the_thread_is_ignored() {
    let messages = thread(5);

    let entries = thread_window(&messages, &anchors(&[99]), 2, 60);

    assert!(entries.is_empty());
}

#[test]
fn a_window_spans_the_radius_on_both_sides_of_the_anchor() {
    let messages = thread(11);

    let entries = thread_window(&messages, &anchors(&[5]), 2, 60);

    assert_eq!(ids(&entries), vec![3, 4, 5, 6, 7]);
}

#[test]
fn a_window_clamps_at_both_ends_of_the_thread() {
    let messages = thread(3);

    let entries = thread_window(&messages, &anchors(&[0, 2]), 10, 60);

    assert_eq!(ids(&entries), vec![0, 1, 2]);
    assert!(elisions(&entries).is_empty());
}

#[test]
fn overlapping_windows_merge_without_repeating_a_message() {
    let messages = thread(10);

    let entries = thread_window(&messages, &anchors(&[3, 5]), 2, 60);

    assert_eq!(ids(&entries), vec![1, 2, 3, 4, 5, 6, 7]);
}

#[test]
fn a_gap_between_windows_is_marked_elided() {
    let messages = thread(20);

    let entries = thread_window(&messages, &anchors(&[2, 15]), 1, 60);

    assert_eq!(ids(&entries), vec![1, 2, 3, 14, 15, 16]);
    // Message 0 before the first window, then 4..=13 between the two.
    assert_eq!(elisions(&entries), vec![1, 10]);
}

#[test]
fn the_cap_keeps_the_most_recent_messages() {
    let messages = thread(20);

    let entries = thread_window(&messages, &anchors(&[2, 15]), 1, 4);

    assert_eq!(ids(&entries), vec![3, 14, 15, 16]);
}

#[test]
fn a_capped_transcript_still_reports_what_it_dropped() {
    let messages = thread(20);

    let entries = thread_window(&messages, &anchors(&[2, 15]), 1, 4);

    // Everything before message 3, then 4..=13 between the two windows.
    assert_eq!(elisions(&entries), vec![3, 10]);
}

fn bot_thread() -> Vec<ThreadMessage> {
    let mut messages = thread(3);
    messages[1].sender = ChannelSender::new_from_bot(BotId::TEST_A);
    messages[2].sender = ChannelSender::new_from_bot(BotId::TEST_B);
    messages
}

#[test]
fn a_rendered_transcript_marks_the_agents_own_messages() {
    let messages = bot_thread();

    let rendered = render_transcript(
        &thread_window(&messages, &anchors(&[1]), 2, 60),
        BotId::TEST_A,
    );

    assert_eq!(
        rendered,
        format!(
            "[user macro|thread-window-test@macro.com] message 0\n\
             [agent] message 1\n\
             [bot {}] message 2\n",
            BotId::TEST_B.into_storage_id()
        )
    );
}

#[test]
fn a_rendered_transcript_says_where_messages_were_dropped() {
    let messages = thread(20);

    let rendered = render_transcript(
        &thread_window(&messages, &anchors(&[15]), 1, 60),
        BotId::TEST_A,
    );

    assert!(
        rendered.starts_with("(14 earlier messages hidden)\n"),
        "unexpected transcript: {rendered}"
    );
}

#[test]
fn a_single_dropped_message_reads_as_one() {
    let messages = thread(3);

    let rendered = render_transcript(
        &thread_window(&messages, &anchors(&[1]), 0, 60),
        BotId::TEST_A,
    );

    assert!(
        rendered.starts_with("(1 earlier message hidden)\n"),
        "unexpected transcript: {rendered}"
    );
}
