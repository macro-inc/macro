use super::*;
use macro_document_model::plugins_group_b::{CodeToken, CodeTokenError};

fn text(text: &str, highlight_type: Option<&str>) -> CodeToken {
    CodeToken::Text {
        text: text.into(),
        highlight_type: highlight_type.map(Into::into),
    }
}

#[test]
fn decodes_every_reply_shape() {
    assert_eq!(
        decode_loaded(r#"{"kind":"loaded","loaded":true}"#),
        Ok(true)
    );
    assert_eq!(
        decode_loaded(r#"{"kind":"loaded","loaded":false}"#),
        Ok(false)
    );
    assert_eq!(
        decode_tokens(
            r#"{"kind":"tokens","tokens":[{"kind":"text","text":"let","highlightType":"keyword"},{"kind":"text","text":" ","highlightType":null},{"kind":"lineBreak"},{"kind":"tab"}]}"#
        ),
        Ok(vec![
            text("let", Some("keyword")),
            text(" ", None),
            CodeToken::LineBreak,
            CodeToken::Tab,
        ])
    );
}

#[test]
fn rejects_every_other_shape_as_a_content_free_host_error() {
    for reply in [
        "",
        "not json",
        "[]",
        r#"{"kind":"loaded"}"#,
        r#"{"kind":"loaded","loaded":1}"#,
        r#"{"kind":"loaded","loaded":true,"extra":1}"#,
        r#"{"kind":"tokens","tokens":[]}"#,
        r#"{"kind":"notLoaded"}"#,
    ] {
        assert_eq!(decode_loaded(reply), Err(CodeTokenError::Host), "{reply}");
    }
    for reply in [
        "",
        "not json",
        "[]",
        r#"{"kind":"notLoaded"}"#,
        r#"{"kind":"loaded","loaded":true}"#,
        r#"{"kind":"unknown"}"#,
        r#"{"kind":"tokens"}"#,
        r#"{"kind":"tokens","tokens":{}}"#,
        r#"{"kind":"tokens","tokens":[["text","a",null]]}"#,
        r#"{"kind":"tokens","tokens":[{"kind":"text","text":"a"}]}"#,
        r#"{"kind":"tokens","tokens":[{"kind":"text","text":1,"highlightType":null}]}"#,
        r#"{"kind":"tokens","tokens":[{"kind":"text","text":"a","highlightType":2}]}"#,
        r#"{"kind":"tokens","tokens":[{"kind":"text","text":"a","highlightType":null,"x":0}]}"#,
        r#"{"kind":"tokens","tokens":[{"kind":"lineBreak","text":"\n"}]}"#,
        r#"{"kind":"tokens","tokens":[1]}"#,
    ] {
        assert_eq!(decode_tokens(reply), Err(CodeTokenError::Host), "{reply}");
    }
}

#[test]
fn tokens_are_nonzero_and_never_wrap() {
    assert_eq!(next_token(0), None);
    assert_eq!(next_token(1), Some((1, 2)));
    assert_eq!(next_token(u64::MAX), None);
}

#[test]
fn one_cause_per_entry_and_a_second_is_dropped_and_counted() {
    let mut causes = Causes::default();
    causes.begin(1);
    assert_eq!(causes.record("first"), Some(1));
    assert_eq!(causes.record("second"), None);
    assert_eq!(causes.dropped(), 1);
    assert!(causes.carry(1));
    causes.end();
    assert_eq!(causes.take(1, 1), Some("first"));
}

#[test]
fn an_untaken_cause_is_retired_and_counted_when_the_next_entry_begins() {
    let mut causes = Causes::default();
    causes.begin(1);
    let cause = causes.record("first").unwrap();
    assert!(causes.carry(cause));
    causes.end();
    // Still takeable until the next entry begins.
    causes.begin(2);
    assert_eq!(causes.dropped(), 1);
    assert_eq!(causes.take(1, cause), None);
}

#[test]
fn a_throw_after_many_untaken_entries_is_still_recorded() {
    let mut causes = Causes::default();
    for entry in 1..=8 {
        causes.begin(entry);
        let cause = causes.record(entry).unwrap();
        assert!(causes.carry(cause));
        causes.end();
    }
    causes.begin(9);
    let cause = causes.record(9).unwrap();
    assert!(causes.carry(cause));
    causes.end();
    assert_eq!(causes.take(9, cause), Some(9));
    assert_eq!(causes.dropped(), 8);
}

#[test]
fn an_unreported_cause_is_retired_with_its_entry_and_not_counted() {
    let mut causes = Causes::default();
    causes.begin(1);
    assert_eq!(causes.record("swallowed"), Some(1));
    causes.end();
    assert_eq!(causes.take(1, 1), None);
    assert_eq!(causes.dropped(), 0);
}

#[test]
fn takes_need_the_exact_pair_and_succeed_once() {
    let mut causes = Causes::default();
    causes.begin(4);
    let cause = causes.record("value").unwrap();
    assert!(causes.carry(cause));
    assert!(!causes.carry(cause + 1));
    causes.end();
    assert_eq!(causes.take(3, cause), None);
    assert_eq!(causes.take(4, cause + 1), None);
    assert_eq!(causes.take(4, cause), Some("value"));
    assert_eq!(causes.take(4, cause), None);
}

#[test]
fn a_throw_outside_every_entry_is_dropped_and_counted() {
    let mut causes = Causes::default();
    assert_eq!(causes.record("early"), None);
    assert_eq!(causes.dropped(), 1);
}
