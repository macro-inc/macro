use super::*;

fn blocks(value: serde_json::Value) -> Vec<Block> {
    serde_json::from_value(value).unwrap()
}

#[test]
fn a_rich_text_message_becomes_mrkdwn_with_its_mentions_links_and_structure() {
    // As Slack's desktop client sends it, with `text` empty.
    let message = blocks(serde_json::json!([{
        "type": "rich_text",
        "block_id": "aB3",
        "elements": [
            {"type": "rich_text_section", "elements": [
                {"type": "text", "text": "Hi "},
                {"type": "user", "user_id": "U0ALICE123"},
                {"type": "text", "text": ", the "},
                {"type": "text", "text": "launch", "style": {"bold": true}},
                {"type": "text", "text": " moved to "},
                {"type": "link", "url": "https://example.com/plan", "text": "the plan"},
                {"type": "text", "text": " in "},
                {"type": "channel", "channel_id": "C0SHARED12"},
                {"type": "text", "text": " "},
                {"type": "emoji", "name": "tada", "unicode": "1f389"},
                {"type": "text", "text": "\n"}
            ]},
            {"type": "rich_text_list", "style": "ordered", "indent": 0, "elements": [
                {"type": "rich_text_section", "elements": [{"type": "text", "text": "review "}, {"type": "text", "text": "a < b & c", "style": {"code": true}}]},
                {"type": "rich_text_section", "elements": [{"type": "text", "text": "ship it", "style": {"italic": true, "strike": true}}]}
            ]},
            {"type": "rich_text_list", "style": "bullet", "indent": 1, "elements": [
                {"type": "rich_text_section", "elements": [{"type": "text", "text": "nested"}]}
            ]},
            {"type": "rich_text_quote", "elements": [
                {"type": "text", "text": "quoted line one\nline two"}
            ]},
            {"type": "rich_text_preformatted", "elements": [
                {"type": "text", "text": "cargo test -p slack_linked"}
            ]},
            {"type": "rich_text_section", "elements": [
                {"type": "broadcast", "range": "here"},
                {"type": "text", "text": " thumbs "},
                {"type": "emoji", "name": "+1", "skin_tone": 3}
            ]}
        ]
    }, {"type": "divider"}]));

    assert_eq!(
        blocks_to_mrkdwn(&message),
        "Hi <@U0ALICE123>, the *launch* moved to <https://example.com/plan|the plan> in <#C0SHARED12> :tada:\n\
         1. review `a &lt; b &amp; c`\n\
         2. _~ship it~_\n\
         \u{20}   • nested\n\
         > quoted line one\n\
         > line two\n\
         ```\ncargo test -p slack_linked\n```\n\
         <!here> thumbs :+1::skin-tone-3:"
    );
}

#[test]
fn styles_keep_surrounding_spaces_outside_their_markers() {
    let message = blocks(serde_json::json!([{
        "type": "rich_text",
        "elements": [{"type": "rich_text_section", "elements": [
            {"type": "text", "text": "a"},
            {"type": "text", "text": " bold ", "style": {"bold": true}},
            {"type": "text", "text": "b"}
        ]}]
    }]));
    assert_eq!(blocks_to_mrkdwn(&message), "a *bold* b");
}
