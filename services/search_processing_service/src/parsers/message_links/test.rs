use super::message_links;

#[test]
fn a_link_is_found_whatever_its_label() {
    assert_eq!(
        message_links(
            "Designs <m-link>{\"url\":\"https://app.sketchpad.example/file/0ABC\",\"text\":\"https://app.sketchpad.example/file/0ABC\",\"title\":\"\"}</m-link> and <m-link>{\"url\":\"https://docs.example.com/d/1AbC/edit?usp=sharing\",\"text\":\"the spec\",\"title\":\"\"}</m-link>"
        ),
        [
            "https://app.sketchpad.example/file/0ABC",
            "https://docs.example.com/d/1AbC/edit"
        ]
    );
}

#[test]
fn urls_written_as_text_are_links_too() {
    assert_eq!(
        message_links(
            "Notes: [the spec](https://docs.example.com/d/1) and [https://example.org/a](https://example.org/a), also www.example.net/b."
        ),
        [
            "https://docs.example.com/d/1",
            "https://example.org/a",
            "www.example.net/b"
        ]
    );
}

#[test]
fn a_paste_holding_a_url_shares_it() {
    assert_eq!(
        message_links(
            "see\n\n<m-paste>{\"content\":\"failed fetching https://ci.example.com/runs/42 \\u003cretrying\\u003e\",\"origin\":\"pasted\"}</m-paste>"
        ),
        ["https://ci.example.com/runs/42"]
    );
}

#[test]
fn each_link_is_listed_once_in_order() {
    assert_eq!(
        message_links(
            "<m-link>{\"url\":\"https://b.example.com\",\"text\":\"https://b.example.com\"}</m-link> https://a.example.com https://b.example.com"
        ),
        ["https://b.example.com", "https://a.example.com"]
    );
}

#[test]
fn the_punctuation_around_a_url_is_not_part_of_it() {
    for (text, link) in [
        ("(see https://example.com/a).", "https://example.com/a"),
        ("https://example.com/a, then", "https://example.com/a"),
        ("**https://example.com/a**", "https://example.com/a"),
        ("'https://example.com/a'?", "https://example.com/a"),
        (
            "https://en.wikipedia.org/wiki/Rust_(language).",
            "https://en.wikipedia.org/wiki/Rust_(language)",
        ),
        ("<https://example.com/a>", "https://example.com/a"),
        ("HTTPS://Example.com/A", "HTTPS://Example.com/A"),
        ("（https://example.com/a）", "https://example.com/a"),
        ("“https://example.com/a”", "https://example.com/a"),
        ("https://example.com/a。次に", "https://example.com/a"),
        ("https://example.com/café", "https://example.com/café"),
    ] {
        assert_eq!(message_links(text), [link], "{text}");
    }
}

#[test]
fn text_that_only_looks_like_a_link_shares_none() {
    for text in [
        "",
        "no links here",
        "https:// alone",
        "awww.example.com and xhttps://example.com",
        "the www. prefix",
        "<m-link>{\"url\":\"mailto:someone@example.com\",\"text\":\"mail\"}</m-link>",
        "<m-link>{\"url\":\"/app/md/0193\",\"text\":\"a doc\"}</m-link>",
    ] {
        assert!(message_links(text).is_empty(), "{text}");
    }
}

#[test]
fn other_chips_are_not_read_as_text() {
    assert_eq!(
        message_links(
            "<m-user-mention>{\"userId\":\"macro|a@example.com\"}</m-user-mention>https://example.com/after"
        ),
        ["https://example.com/after"]
    );
}

#[test]
fn markup_that_does_not_parse_still_shares_its_links() {
    assert_eq!(
        message_links(
            "a < b <m-link>{\"url\":\"https://example.com/x\",\"text\":\"label\"}</m-link>"
        ),
        ["https://example.com/x"]
    );
}

#[test]
fn a_link_is_indexed_up_to_its_query_and_fragment() {
    for (text, link) in [
        (
            "https://docs.example.com/d/1/edit?usp=sharing#heading=h.1",
            "https://docs.example.com/d/1/edit",
        ),
        ("https://example.com/a#section", "https://example.com/a"),
        ("(https://example.com/a?x=(1))", "https://example.com/a"),
        ("https://example.com?q=1", "https://example.com"),
    ] {
        assert_eq!(message_links(text), [link], "{text}");
    }
    assert!(message_links("https://?q=1").is_empty());
}

/// The analyzer of `links` never splits a long run of letters, and a token
/// over 32,766 bytes would fail the message's whole document.
#[test]
fn a_long_link_keeps_its_start() {
    let path = "é".repeat(20_000);
    let links = message_links(&format!("see https://example.com/{path} now"));
    assert_eq!(links.len(), 1);
    assert!(links[0].len() <= 2048, "{}", links[0].len());
    assert!(links[0].starts_with("https://example.com/éé"));
}

/// A run of closing brackets after a link is trimmed in one pass.
#[test]
fn a_run_of_closing_brackets_is_trimmed_at_once() {
    let text = format!("https://example.com/a{}", ").".repeat(200_000));
    assert_eq!(message_links(&text), ["https://example.com/a"]);
}
