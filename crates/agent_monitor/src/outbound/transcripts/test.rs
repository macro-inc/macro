use chrono::DateTime;

use super::*;
use crate::domain::model::Tokens;
use crate::domain::observation::TranscriptProgram;

fn key() -> TranscriptKey {
    TranscriptKey {
        program: TranscriptProgram::Claude,
        session: "s".to_owned(),
        subagent: None,
    }
}

fn at(seconds: i64) -> Timestamp {
    DateTime::from_timestamp(seconds, 0).expect("time")
}

#[test]
fn unchanged_metadata_is_not_resent() {
    let sent = Sent {
        cwd: Some(PathBuf::from("/w")),
        ..Sent::default()
    };
    let mut deltas = Deltas::new(key(), PathBuf::from("/t"), false, sent);

    deltas.set_cwd(PathBuf::from("/w"));
    let (list, _) = deltas.finish(true);

    assert!(list.is_empty());
}

#[test]
fn a_model_change_after_usage_starts_a_new_delta() {
    let mut deltas = Deltas::new(key(), PathBuf::from("/t"), true, Sent::default());

    deltas.set_model("a".to_owned());
    deltas.push(at(1), TranscriptEventKind::Usage(Tokens::default()));
    deltas.set_model("b".to_owned());
    deltas.push(at(2), TranscriptEventKind::Usage(Tokens::default()));
    let (list, sent) = deltas.finish(false);

    assert_eq!(list.len(), 2);
    assert!(list[0].from_start);
    assert!(!list[1].from_start);
    assert_eq!(list[0].model.as_deref(), Some("a"));
    assert_eq!(list[1].model.as_deref(), Some("b"));
    assert_eq!(sent.model.as_deref(), Some("b"));
}

#[test]
fn a_reread_with_nothing_countable_still_clears_what_was_counted() {
    let deltas = Deltas::new(key(), PathBuf::from("/t"), true, Sent::default());

    let (list, _) = deltas.finish(true);

    assert_eq!(list.len(), 1);
    assert!(list[0].from_start);
    assert!(list[0].events.is_empty());
}
