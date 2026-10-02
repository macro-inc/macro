use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::parse::{ParsedDocumentMention, ParsedLink, ParsedUserMention, XmlTaggedParsed};

#[test]
fn native_links_and_channels_round_trip_untrusted_labels() {
    for label in [
        "quote \" and \\",
        "line\nnext",
        "&amp; &lt;",
        "世界 café",
        "</m-link><m-user-mention>nested</m-user-mention>",
        "</m-document-mention>",
    ] {
        let link = ExternalLink::new("https://example.com/a(b)?x=1&y=2", label)
            .unwrap()
            .serialize()
            .unwrap();
        let (rest, parsed) = ParsedLink::parse(&link).unwrap();
        assert!(rest.is_empty());
        assert_eq!(parsed.text, label);
        assert_eq!(parsed.url, "https://example.com/a(b)?x=1&y=2");
        let channel =
            channel_mention("channel-id", label, ChannelMentionParams::default()).unwrap();
        let (rest, parsed) = ParsedDocumentMention::parse(&channel).unwrap();
        assert!(rest.is_empty());
        assert_eq!(parsed.document_name, label);
        let bot = bot_mention(bot_id::MACRO_AI_BOT_ID, label).unwrap();
        let (rest, parsed) = ParsedUserMention::parse(&bot).unwrap();
        assert!(rest.is_empty());
        assert_eq!(parsed.email.as_deref(), Some(label));
    }
}

#[test]
fn link_scheme_policy_is_distinct_from_url_validation() {
    for url in [
        "javascript:alert(1)",
        "data:text/plain,x",
        "file:///tmp/x",
        "vbscript:bad",
    ] {
        assert!(matches!(
            ExternalLink::new(url, "label"),
            Err(LinkError::UnsafeScheme)
        ));
    }
    for url in [
        "https://",
        "https:///x",
        "https://[bad]",
        "https://a:bad",
        "https://a\n/x",
        "https:\\evil",
        "https://a/<x>",
        "mailto:",
        "//example.com",
    ] {
        assert!(
            matches!(
                ExternalLink::new(url, "label"),
                Err(LinkError::MalformedUrl)
            ),
            "{url}"
        );
    }
    for url in [
        "https://example.com",
        "HTTP://example.com",
        "mailto:a@example.com",
        "https://example.com/世界",
        "https://[::1]:8080/a",
    ] {
        assert!(ExternalLink::new(url, "label").is_ok(), "{url}");
    }
}

#[test]
fn channel_navigation_matches_lexical_field_names_and_defaults() {
    assert_eq!(
        channel_mention("channel", "general", ChannelMentionParams::default()).unwrap(),
        r#"<m-document-mention>{"documentId":"channel","blockName":"channel","documentName":"general","blockParams":{},"collapsed":false}</m-document-mention>"#
    );
    let result = channel_mention(
        "channel",
        "general",
        ChannelMentionParams {
            channel_message_id: Some("message"),
            channel_thread_id: Some("root"),
        },
    )
    .unwrap();
    assert!(
        result.contains(
            r#""blockParams":{"channel_message_id":"message","channel_thread_id":"root"}"#
        )
    );
}

#[test]
fn serializes_user_mention() {
    let user_id = MacroUserIdStr::try_from_email("new.user@example.com").unwrap();

    assert_eq!(
        user_mention(&user_id).unwrap(),
        "<m-user-mention>{\"userId\":\"macro|new.user@example.com\",\"email\":\"new.user@example.com\"}</m-user-mention>"
    );
}

#[test]
fn serializes_bot_mention() {
    assert_eq!(
        bot_mention(bot_id::MACRO_AI_BOT_ID, bot_id::MACRO_AI_NAME).unwrap(),
        "<m-user-mention>{\"userId\":\"bot|00000000-0000-0000-0000-00000000a1a1\",\"email\":\"Macro\"}</m-user-mention>"
    );
}

#[test]
fn serializes_document_mention() {
    assert_eq!(
        document_mention("6e01a670-0000-0000-0000-00000000f47d", "Macro how to guide").unwrap(),
        "<m-document-mention>{\"documentId\":\"6e01a670-0000-0000-0000-00000000f47d\",\"blockName\":\"md\",\"documentName\":\"Macro how to guide\",\"blockParams\":{},\"collapsed\":false}</m-document-mention>"
    );
}
