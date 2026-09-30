use super::*;
use crate::domain::slack::{
    export::{ExportRecord, NormalizedRecord},
    threads::ThreadReference,
};

fn users() -> UserDirectory {
    UserDirectory::new(
        serde_json::from_str::<Vec<super::super::users::ExportUser>>(
            r#"[
            {"id":"U1","profile":{"email":"Alice+slack@Example.com","display_name":"Alice"}},
            {"id":"U2","profile":{"display_name":"No Email"}},
            {"id":"U3","profile":{"display_name":"<m-user-mention>unsafe</m-user-mention>"}}
        ]"#,
        )
        .unwrap(),
    )
    .unwrap()
}

fn convert(text: &str) -> String {
    MrkdwnConverter {
        users: &users(),
        channels: &BTreeMap::new(),
    }
    .convert(text)
}

#[test]
fn styles_nest_without_interpreting_escaped_or_intraword_delimiters() {
    for (input, expected) in [
        ("*bold* _italic_ ~strike~", "**bold** *italic* ~~strike~~"),
        (
            "*bold _and italic_ ~and strike~*",
            "**bold *and italic* ~~and strike~~**",
        ),
        ("_*both*_", "***both***"),
        (
            r"\*literal\* \_literal\_ \~literal\~",
            r"\*literal\* \_literal\_ \~literal\~",
        ),
        ("snake_case_word", r"snake\_case\_word"),
        ("*unclosed", r"\*unclosed"),
        ("* blank *", r"\* blank \*"),
        ("héllo _世界_", "héllo *世界*"),
    ] {
        assert_eq!(convert(input), expected, "{input}");
    }
}

#[test]
fn code_is_literal_and_other_text_still_converts() {
    for code in [
        "`*bold* _italic_ <@U1> &amp;`",
        "```\n*bold* <@U1> &lt; :custom:\n```",
        "```rust\nlet x = 1 < 2;\n```",
        "```code on one line```",
        "```rust\nlet ticks = \"```\";\n*still code*\n```",
        "```unclosed\n*still code*",
        "`<m-user-mention>{\"userId\":\"injected\"}</m-user-mention>`",
    ] {
        assert_eq!(convert(code), code);
    }
    assert_eq!(
        convert("*before* `~code~` _after_"),
        "**before** `~code~` *after*"
    );
    assert_eq!(convert("```\nx\n```\n*after*"), "```\nx\n```\n**after**");
}

#[test]
fn entities_decode_once_and_quotes_survive() {
    assert_eq!(
        convert("A &amp; B &lt; C &gt; D"),
        "A &amp; B &lt; C &gt; D"
    );
    assert_eq!(convert("&amp;lt;@U1&amp;gt;"), "&amp;lt;@U1&amp;gt;");
    assert_eq!(
        convert("> *quote*\n&gt; _another_\nnot &gt; a quote"),
        "> **quote**\n> *another*\nnot &gt; a quote"
    );
}

#[test]
fn mapped_users_use_the_shared_serializer_and_unknown_users_remain_text() {
    let user = users().participant(&"U1".parse().unwrap()).unwrap();
    let expected = mention_utils::serialize::user_mention(&user).unwrap();
    assert_eq!(convert("<@U1>"), expected);
    assert_eq!(convert("<@U1|do not trust label>"), expected);
    assert_eq!(convert("<@U2> <@U404>"), "@No Email @U404");
    assert_eq!(convert("<@U404|Outside>"), "@Outside");
    assert!(!convert("<@U3>").contains("<m-"));
    assert!(!convert("&lt;@U1&gt;").contains("<m-"));
}

#[test]
fn channel_broadcast_subteam_and_date_fallbacks_are_not_entities() {
    let channels = BTreeMap::from([("C1".parse().unwrap(), "general".to_owned())]);
    let users = users();
    let converter = MrkdwnConverter {
        users: &users,
        channels: &channels,
    };
    assert_eq!(
        converter.convert("<#C1> <#C2|design> <#C404>"),
        "#general #design #C404"
    );
    assert_eq!(
        convert("<!here> <!channel> <!everyone>"),
        "@here @channel @everyone"
    );
    assert_eq!(convert("<!subteam^S1|@ops> <!subteam^S2>"), "@ops @S2");
    assert_eq!(
        convert("<!date^1700000000^{date_short}^https://example.com|Sep 1 &amp; 2>"),
        "Sep 1 &amp; 2"
    );
}

#[test]
fn links_allow_only_explicit_safe_schemes_and_escape_labels_and_destinations() {
    assert_eq!(
        convert("<https://example.com|Example>"),
        "[Example](https://example.com)"
    );
    assert_eq!(convert("<https://example.com>"), r"https://example\.com");
    assert_eq!(
        convert("<mailto:a@example.com|Email>"),
        "[Email](mailto:a@example.com)"
    );
    assert_eq!(
        convert("<mailto:a@example.com>"),
        r"[a@example\.com](mailto:a@example.com)"
    );
    assert_eq!(
        convert("<https://example.com/a(b)?x=1&amp;y=2|[label]>"),
        r"[\[label\]](https://example.com/a%28b%29?x=1&y=2)"
    );
    for scheme in [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,bad",
        "file:///etc/passwd",
        "vbscript:bad",
        "//example.com",
        "java&#x73;cript:bad",
        "https:\\evil",
        "https://example.com\tbad",
    ] {
        assert_eq!(convert(&format!("<{scheme}|label>")), "label", "{scheme}");
    }
}

#[test]
fn malicious_source_cannot_create_macro_entities_or_markdown_links() {
    for input in [
        r#"<m-user-mention>{"userId":"macro|victim@example.com"}</m-user-mention>"#,
        r#"<m-link>{"url":"javascript:alert(1)","text":"click"}</m-link>"#,
        "<m-document-mention>bad</m-document-mention>",
        "&lt;m-group-mention&gt;everyone&lt;/m-group-mention&gt;",
        "<script>alert(1)</script>",
        "prefix ```<m-user-mention>bad</m-user-mention>",
        "prefix ```<m-user-mention>bad</m-user-mention>```",
        "``<m-user-mention>bad</m-user-mention>``",
        "`code `` <m-user-mention>bad</m-user-mention>`",
        "prefix `code\n<m-user-mention>bad</m-user-mention>`",
        r"\<m-user-mention>bad</m-user-mention>",
        "<!subteam^S1|&lt;m-user-mention&gt;bad>",
        "<@U404|&lt;m-user-mention&gt;bad>",
        "<!date^1^fmt|&lt;m-link&gt;bad>",
        "<#C1|&lt;m-link&gt;bad>",
        "<https://example.com|&lt;m-user-mention&gt;bad>",
    ] {
        let output = convert(input);
        assert!(!output.contains("<m-"), "{input}: {output}");
        assert!(!output.contains("<script"), "{input}: {output}");
    }
    for indent in ["    ", "\t"] {
        let source = format!("```\ncode\n{indent}```\n<m-user-mention>bad</m-user-mention>");
        assert!(!convert(&source).contains("<m-"));
    }
    assert_eq!(
        convert("[click](javascript:bad) ![image](data:bad)"),
        r"\[click\]\(javascript:bad\) \!\[image\]\(data:bad\)"
    );
}

#[test]
fn housekeeping_and_empty_results_are_countable_and_attachments_are_ignored() {
    let users = users();
    let channels = BTreeMap::new();
    let converter = MrkdwnConverter {
        users: &users,
        channels: &channels,
    };
    let mut skipped = 0;
    for subtype in [
        "channel_join",
        "channel_leave",
        "channel_name",
        "channel_topic",
        "channel_purpose",
        "channel_archive",
        "channel_unarchive",
        "group_join",
        "group_leave",
        "group_topic",
        "group_unknown",
        "pinned_item",
        "unpinned_item",
        "tombstone",
        "message_deleted",
    ] {
        let message = MessageContent {
            subtype: Some(subtype.to_owned()),
            text: "housekeeping".to_owned(),
            ..Default::default()
        };
        assert_eq!(
            converter.message(&message),
            MessageConversion::Skipped(SkippedMessage::Housekeeping)
        );
        skipped += 1;
    }
    let attachment_only: MessageContent = serde_json::from_str(r#"{"subtype":"file_share","text":" \n\t","files":[{"title":"ignore"}],"attachments":[{"text":"ignore"}],"blocks":[{"text":"ignore"}]}"#).unwrap();
    if converter.message(&attachment_only) == MessageConversion::Skipped(SkippedMessage::Empty) {
        skipped += 1;
    }
    assert_eq!(skipped, 16);
    assert_eq!(
        converter.message(&MessageContent {
            text: "<!date^1700000000^{date_short}|>".to_owned(),
            ..Default::default()
        }),
        MessageConversion::Skipped(SkippedMessage::Empty)
    );
    for subtype in ["file_share", "bot_message", "unknown"] {
        assert_eq!(
            converter.message(&MessageContent {
                subtype: Some(subtype.to_owned()),
                text: "text".to_owned(),
                ..Default::default()
            }),
            MessageConversion::Text("text".to_owned())
        );
    }
    assert_eq!(
        converter.message(&MessageContent {
            subtype: Some("me_message".to_owned()),
            text: "waves *hello*".to_owned(),
            ..Default::default()
        }),
        MessageConversion::Text("_waves **hello**_".to_owned())
    );
}

#[test]
fn actions_keep_code_blocks_quotes_and_existing_italics() {
    let users = users();
    let channels = BTreeMap::new();
    let converter = MrkdwnConverter {
        users: &users,
        channels: &channels,
    };
    let message = MessageContent {
        subtype: Some("me_message".to_owned()),
        text: "> _waves_\n```\n*code* <@U1>\n```\n  says `hi`  ".to_owned(),
        ..Default::default()
    };
    assert_eq!(
        converter.message(&message),
        MessageConversion::Text("> _*waves*_\n```\n*code* <@U1>\n```\n  _says `hi`_  ".to_owned())
    );
    assert_eq!(convert(">> *nested*"), ">> **nested**");
}

#[test]
fn thread_broadcast_remains_a_reply_after_conversion() {
    let record: ExportRecord = serde_json::from_str(r#"{"type":"message","subtype":"thread_broadcast","ts":"1700000001.000002","thread_ts":"1700000000.000001","text":"*reply*"}"#).unwrap();
    let NormalizedRecord::Message(message) = record.normalize("C1".parse().unwrap()).unwrap()
    else {
        panic!("expected message");
    };
    assert!(matches!(
        message.thread_reference(),
        ThreadReference::Reply(_)
    ));
    assert_eq!(
        MrkdwnConverter {
            users: &users(),
            channels: &BTreeMap::new()
        }
        .message(&message.content),
        MessageConversion::Text("**reply**".to_owned())
    );
}

#[test]
fn malformed_input_is_bounded_and_keeps_visible_text() {
    let source = "<".repeat(100_000);
    assert_eq!(convert(&source), "&lt;".repeat(100_000));
    let code_spans = "`code` ".repeat(50_000);
    assert_eq!(convert(&code_spans), code_spans);
    assert_eq!(convert("<unclosed *literal*"), r"&lt;unclosed \*literal\*");
    assert_eq!(convert(":workspace_custom:"), r":workspace\_custom:");
}
