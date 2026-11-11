use super::*;
use macro_document_model::plugins_group_b::{CodeToken, CodeTokenError, CodeTokenResult};

fn text(text: &str, highlight_type: Option<&str>) -> CodeToken {
    CodeToken::Text {
        text: text.into(),
        highlight_type: highlight_type.map(Into::into),
    }
}

#[test]
fn decodes_every_reply_shape() {
    assert_eq!(
        decode(r#"{"kind":"notLoaded"}"#),
        Ok(CodeTokenResult::NotLoaded)
    );
    assert_eq!(
        decode(
            r#"{"kind":"tokens","tokens":[{"kind":"text","text":"let","highlightType":"keyword"},{"kind":"text","text":" ","highlightType":null},{"kind":"lineBreak"},{"kind":"tab"}]}"#
        ),
        Ok(CodeTokenResult::Tokens(vec![
            text("let", Some("keyword")),
            text(" ", None),
            CodeToken::LineBreak,
            CodeToken::Tab,
        ]))
    );
}

#[test]
fn rejects_every_other_shape_as_a_content_free_host_error() {
    for reply in [
        "",
        "not json",
        "[]",
        r#"["notLoaded"]"#,
        r#"{"kind":"notLoaded","extra":1}"#,
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
        assert_eq!(decode(reply), Err(CodeTokenError::Host), "{reply}");
    }
}

#[test]
fn tokens_are_nonzero_and_never_wrap() {
    assert_eq!(next_token(0), None);
    assert_eq!(next_token(1), Some((1, 2)));
    assert_eq!(next_token(u64::MAX), None);
}
