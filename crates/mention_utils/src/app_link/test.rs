use cool_asserts::assert_matches;

use super::*;

const MESSAGE_URL: &str = "https://macro.com/app/channel/0195d2dd-5de9-71f2-9d59-5d9734f1adb7?channel_message_id=01a1eaa3-102a-7bbc-8d8f-8a427f9efecb";
const MESSAGE_CHIP: &str = r#"<m-document-mention>{"documentId":"0195d2dd-5de9-71f2-9d59-5d9734f1adb7","blockName":"channel","documentName":"","blockParams":{"channel_message_id":"01a1eaa3-102a-7bbc-8d8f-8a427f9efecb"},"collapsed":false}</m-document-mention>"#;
const TASK_URL: &str = "https://macro.com/app/task/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3";
const TASK_CHIP: &str = r#"<m-document-mention>{"documentId":"01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3","blockName":"task","documentName":"","blockParams":{},"collapsed":false}</m-document-mention>"#;

fn prod() -> AppLinkChips {
    AppLinkChips::new("https://macro.com").unwrap()
}

#[test]
fn a_bare_channel_message_url_becomes_a_message_chip() {
    let markdown = format!("Asked in {MESSAGE_URL} by support.");
    assert_eq!(
        prod().rewrite(&markdown).markdown,
        format!("Asked in {MESSAGE_CHIP} by support.")
    );
}

#[test]
fn a_markdown_link_to_an_app_page_becomes_a_chip() {
    let markdown = format!("See [the original message]({MESSAGE_URL}) and [the task]({TASK_URL}).");
    assert_eq!(
        prod().rewrite(&markdown).markdown,
        format!("See {MESSAGE_CHIP} and {TASK_CHIP}.")
    );
}

#[test]
fn an_autolink_becomes_a_chip() {
    assert_eq!(
        prod().rewrite(&format!("Source: <{TASK_URL}>")).markdown,
        format!("Source: {TASK_CHIP}")
    );
}

#[test]
fn trailing_punctuation_stays_after_the_chip() {
    assert_eq!(
        prod()
            .rewrite(&format!("Done ({TASK_URL}), then {TASK_URL}!"))
            .markdown,
        format!("Done ({TASK_CHIP}), then {TASK_CHIP}!")
    );
}

#[test]
fn www_host_and_trailing_slash_are_the_same_page_and_referral_codes_drop() {
    assert_eq!(
        prod().rewrite(
            "https://www.macro.com/app/md/0198a4cc-e138-7670-a308-a6b766602725/?referral_code=abc"
        ).markdown,
        r#"<m-document-mention>{"documentId":"0198a4cc-e138-7670-a308-a6b766602725","blockName":"md","documentName":"","blockParams":{},"collapsed":false}</m-document-mention>"#
    );
}

#[test]
fn the_agents_route_is_the_agent_block() {
    assert_eq!(
        prod()
            .rewrite("https://macro.com/app/agents/0198a4cc-e138-7670-a308-a6b766602725")
            .markdown,
        r#"<m-document-mention>{"documentId":"0198a4cc-e138-7670-a308-a6b766602725","blockName":"agent","documentName":"","blockParams":{},"collapsed":false}</m-document-mention>"#
    );
}

#[test]
fn local_origins_keep_their_port() {
    let local = AppLinkChips::new("http://localhost:3000").unwrap();
    assert_eq!(
        local
            .rewrite("http://localhost:3000/app/task/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3")
            .markdown,
        TASK_CHIP
    );
    let other_port = "http://localhost:3001/app/task/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3";
    assert_eq!(local.rewrite(other_port).markdown, other_port);
}

#[test]
fn code_and_existing_tags_are_left_alone() {
    let markdown = format!(
        "Inline `{TASK_URL}` stays.\n```\n{TASK_URL}\n```\n<m-link>{{\"url\":\"{TASK_URL}\",\"text\":\"t\",\"title\":\"\"}}</m-link> {TASK_URL}\n"
    );
    assert_eq!(
        prod().rewrite(&markdown).markdown,
        format!(
            "Inline `{TASK_URL}` stays.\n```\n{TASK_URL}\n```\n<m-link>{{\"url\":\"{TASK_URL}\",\"text\":\"t\",\"title\":\"\"}}</m-link> {TASK_CHIP}\n"
        )
    );
}

#[test]
fn links_that_are_not_app_items_are_left_alone() {
    for markdown in [
        "https://example.com/app/task/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3",
        "https://dev.macro.com/app/task/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3",
        "https://macro.com/app/task/not-a-uuid",
        "https://macro.com/app/pr/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3",
        "https://macro.com/app/settings/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3",
        "https://macro.com/app/task/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3/comments",
        "https://macro.com/pricing",
        "[docs](https://docs.macro.com/app/md/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3)",
        "![shot](https://macro.com/app/image/01a1eaa3-60b7-70c7-9f00-32eb7f2fbdd3)",
    ] {
        assert_eq!(prod().rewrite(markdown).markdown, markdown);
    }
}

#[test]
fn markdown_without_app_links_is_borrowed() {
    assert_matches!(
        prod()
            .rewrite("Nothing to see at https://example.com.")
            .markdown,
        Cow::Borrowed(_)
    );
}

#[test]
fn an_app_url_that_is_not_an_origin_is_refused() {
    assert!(AppLinkChips::new("not a url").is_err());
}

#[test]
fn links_with_titles_reference_definitions_and_attributes_keep_their_syntax() {
    for markdown in [
        format!("[spec]({TASK_URL} \"Title\")"),
        format!("[1]: {TASK_URL}\n\nSee [the task][1]."),
        format!("<a href=\"{TASK_URL}\">task</a>"),
        format!("<a href='{TASK_URL}'>task</a>"),
    ] {
        assert_eq!(prod().rewrite(&markdown).markdown, markdown);
    }
}

#[test]
fn indented_and_nested_fences_stay_code() {
    let nested = format!("- step\n    ```\n    {TASK_URL}\n    ```\n{TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&nested).markdown,
        format!("- step\n    ```\n    {TASK_URL}\n    ```\n{TASK_CHIP}\n")
    );
    let longer = format!("````md\n```\n{TASK_URL}\n```\n````\n{TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&longer).markdown,
        format!("````md\n```\n{TASK_URL}\n```\n````\n{TASK_CHIP}\n")
    );
    let tildes = format!("~~~\n```\n{TASK_URL}\n~~~\n{TASK_URL}");
    assert_eq!(
        prod().rewrite(&tildes).markdown,
        format!("~~~\n```\n{TASK_URL}\n~~~\n{TASK_CHIP}")
    );
}

#[test]
fn fences_in_quotes_stay_code() {
    let quoted = format!("> ```\n> {TASK_URL}\n> ```\n> {TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&quoted).markdown,
        format!("> ```\n> {TASK_URL}\n> ```\n> {TASK_CHIP}\n")
    );
    let shown = format!("```md\n> ```\n> {TASK_URL}\n> ```\n```\n{TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&shown).markdown,
        format!("```md\n> ```\n> {TASK_URL}\n> ```\n```\n{TASK_CHIP}\n")
    );
}

#[test]
fn a_code_span_closes_only_on_a_run_of_its_own_length() {
    let double = format!("`` a`b {TASK_URL} `` then {TASK_URL}");
    assert_eq!(
        prod().rewrite(&double).markdown,
        format!("`` a`b {TASK_URL} `` then {TASK_CHIP}")
    );
    let unmatched = format!("a stray ` then {TASK_URL}");
    assert_eq!(
        prod().rewrite(&unmatched).markdown,
        format!("a stray ` then {TASK_CHIP}")
    );
}

#[test]
fn the_rewrite_counts_its_chips() {
    let markdown = format!("{TASK_URL} and [the message]({MESSAGE_URL}), not `{TASK_URL}`");
    assert_eq!(prod().rewrite(&markdown).chips, 2);
    assert_eq!(prod().rewrite("no links").chips, 0);
}

#[test]
fn a_fence_indented_past_its_opening_is_code() {
    let markdown = format!("```\n    ```\n{TASK_URL}\n```\n{TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&markdown).markdown,
        format!("```\n    ```\n{TASK_URL}\n```\n{TASK_CHIP}\n")
    );
    let tabbed = format!("```\n\t```\n{TASK_URL}\n```\n{TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&tabbed).markdown,
        format!("```\n\t```\n{TASK_URL}\n```\n{TASK_CHIP}\n")
    );
}

#[test]
fn a_fence_that_opens_a_list_item_is_code() {
    let bullet = format!("- ```\n  {TASK_URL}\n  ```\n{TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&bullet).markdown,
        format!("- ```\n  {TASK_URL}\n  ```\n{TASK_CHIP}\n")
    );
    // Inside a block, a list item's fence is code, never a close.
    let shown = format!("```md\n- ```\n  {TASK_URL}\n  ```\n```\n");
    assert_eq!(prod().rewrite(&shown).markdown, shown);
    let numbered = format!("1. ~~~\n   {TASK_URL}\n   ~~~\n{TASK_URL}\n");
    assert_eq!(
        prod().rewrite(&numbered).markdown,
        format!("1. ~~~\n   {TASK_URL}\n   ~~~\n{TASK_CHIP}\n")
    );
}

#[test]
fn a_line_of_unmatched_backtick_runs_is_rewritten_in_one_pass() {
    // About 246 KB, under the rewrite cap.
    let runs: String = (1..=700).map(|length| "`".repeat(length) + " ").collect();
    let markdown = format!("{runs}{TASK_URL}");
    assert_eq!(
        prod().rewrite(&markdown).markdown,
        format!("{runs}{TASK_CHIP}")
    );
}

#[test]
fn unclosed_tags_between_backticks_are_scanned_in_one_pass() {
    let started = std::time::Instant::now();
    let line = "<m-a>`".repeat(100_000);
    assert_eq!(protected_spans(&line).len(), 50_000);
    let markdown = format!("{} {TASK_URL}", "<m-a>`".repeat(40_000));
    assert_eq!(
        prod().rewrite(&markdown).markdown,
        format!("{} {TASK_CHIP}", "<m-a>`".repeat(40_000))
    );
    // Milliseconds when linear; a rescan per token takes minutes.
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
}

#[test]
fn markdown_up_to_the_cap_is_rewritten_and_longer_is_kept() {
    let at_cap = format!(
        "{TASK_URL}{}",
        " ".repeat(MAX_REWRITE_BYTES - TASK_URL.len())
    );
    let rewritten = prod().rewrite(&at_cap);
    assert_eq!(rewritten.chips, 1);
    assert!(!rewritten.skipped_oversize);
    let over_cap = format!("{at_cap} ");
    assert_eq!(
        prod().rewrite(&over_cap),
        Rewritten {
            markdown: Cow::Borrowed(over_cap.as_str()),
            chips: 0,
            skipped_oversize: true,
        }
    );
}
