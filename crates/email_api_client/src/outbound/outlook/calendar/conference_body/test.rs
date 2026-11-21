use super::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

/// Counts the heap bytes each thread holds, so a test measures only its own
/// work while the rest of this crate's tests run in parallel.
struct Counting;

thread_local! {
    static LIVE_BYTES: Cell<usize> = const { Cell::new(0) };
    static PEAK_BYTES: Cell<usize> = const { Cell::new(0) };
}

// SAFETY: every method delegates to `System` with the caller's arguments;
// the counters are const-initialized thread locals, which never allocate.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let live = LIVE_BYTES.with(|live| {
            live.set(live.get() + layout.size());
            live.get()
        });
        PEAK_BYTES.with(|peak| peak.set(peak.get().max(live)));
        // SAFETY: forwarded unchanged from the caller.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE_BYTES.with(|live| live.set(live.get().saturating_sub(layout.size())));
        // SAFETY: forwarded unchanged from the caller.
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Bytes `work` held at its peak, beyond what was held before it.
fn peak_bytes_during(work: impl FnOnce()) -> usize {
    let before = LIVE_BYTES.with(Cell::get);
    PEAK_BYTES.with(|peak| peak.set(before));
    work();
    PEAK_BYTES.with(Cell::get) - before
}

const JOIN: &str = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d&btype=a";

/// The block Teams writes into a meeting's body, as Graph returns it.
fn teams_block() -> String {
    let href = JOIN.replace('&', "&amp;");
    format!(
        "<div class=\"me-email-text\" lang=\"en-US\" style=\"color:#252424\"><div style=\"margin-top:24px\"><span style=\"font-size:24px\">Microsoft Teams meeting</span></div><div style=\"margin-bottom:20px\"><a class=\"me-email-headline\" href=\"{href}\" target=\"_blank\" rel=\"noreferrer noopener\">Join the meeting now</a></div><div><span>Meeting ID: <span>123 456 789 0</span><br>Passcode: <span>abc123</span></span></div><div><a class=\"me-email-link\" href=\"https://aka.ms/JoinTeamsMeeting\">Learn more</a> | <a class=\"me-email-link\" href=\"https://teams.microsoft.com/meetingOptions/\">Meeting options</a></div></div>"
    )
}

#[test]
fn a_teams_invitation_keeps_its_meeting_block_and_the_notes_around_it() {
    let divider = "<div style=\"width:100%\"><span style=\"white-space:nowrap\">________________</span></div>";
    let meta = "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">";
    let body = format!(
        "<html><head>{meta}</head><body><div><p>Agenda: <b>roadmap</b></p></div><br>{divider}{}{divider}</body></html>",
        teams_block()
    );

    let (description, meeting) = split(&body, JOIN).unwrap();

    assert_eq!(meeting, teams_block());
    assert_eq!(
        description,
        format!("{meta}<div><p>Agenda: <b>roadmap</b></p></div><br>{divider}{divider}")
    );
}

/// The Teams block as Macro's description editor exports it: each part a
/// paragraph of its own, without the `me-email*` markers.
fn rewritten_block() -> String {
    let href = JOIN.replace('&', "&amp;");
    format!(
        "<p>Microsoft Teams meeting</p><p><a href=\"{href}\">Join the meeting now</a></p><p>Meeting ID: 123 456 789 0<br>Passcode: abc123</p><p><a href=\"https://aka.ms/JoinTeamsMeeting\">Learn more</a> | <a href=\"https://teams.microsoft.com/meetingOptions/\">Meeting options</a></p>"
    )
}

#[test]
fn a_rewritten_meeting_block_leaves_and_the_notes_around_it_stay() {
    let saved = format!(
        "<html><body><div><p>Agenda</p></div><br>{}</body></html>",
        teams_block()
    );
    let edited = format!(
        "<p>New agenda</p>{}<p>Bring the deck</p>",
        rewritten_block()
    );

    assert_eq!(
        without_meeting(&edited, &saved, JOIN).unwrap(),
        "<p>New agenda</p><p>Bring the deck</p>"
    );
}

#[test]
fn an_edited_description_still_marked_splits_and_one_without_the_link_stays() {
    let saved = format!("<p>Agenda</p>{}", teams_block());

    assert_eq!(
        without_meeting(&format!("<p>New agenda</p>{}", teams_block()), &saved, JOIN).unwrap(),
        "<p>New agenda</p>"
    );
    assert_eq!(
        without_meeting("<p>Only notes</p>", &saved, JOIN).unwrap(),
        "<p>Only notes</p>"
    );
}

#[test]
fn the_join_link_in_the_persons_own_text_is_refused() {
    let saved = format!("<p>Agenda</p>{}", teams_block());
    let href = JOIN.replace('&', "&amp;");
    let typed_into = rewritten_block().replace(
        "Join the meeting now</a></p>",
        "Join the meeting now</a> early</p>",
    );
    let elsewhere = format!(
        "<p>Use <a href=\"{href}\">this link</a></p><p>Notes</p>{}",
        rewritten_block()
    );

    assert!(without_meeting(&typed_into, &saved, JOIN).is_err());
    assert!(without_meeting(&elsewhere, &saved, JOIN).is_err());
}

#[test]
fn line_breaks_graph_puts_between_tags_do_not_keep_meeting_details() {
    let href = JOIN.replace('&', "&amp;");
    // Graph's own layout of the block: line breaks between every tag.
    let block = format!(
        "<div class=\"me-email-text\">\r\n<div><span>Microsoft Teams meeting</span></div>\r\n<div><a href=\"{href}\">Join the meeting now</a></div>\r\n<div><span>Meeting ID: <span>123 456 789 0</span>\r\n<br>\r\nPasscode: <span>abc123</span></span></div>\r\n</div>"
    );
    let saved = format!("<p>Agenda</p>\r\n{block}");
    let edited = format!(
        "<p><img src=\"https://example.com/diagram.png\"></p><p>New agenda</p>{}",
        "<p>Microsoft Teams meeting</p><p><a href=\"HREF\">Join the meeting now</a></p><p>Meeting ID: 123 456 789 0<br>Passcode: abc123</p>"
            .replace("HREF", &href)
    );

    assert_eq!(
        without_meeting(&edited, &saved, JOIN).unwrap(),
        "<p><img src=\"https://example.com/diagram.png\"></p><p>New agenda</p>"
    );
}

#[test]
fn meeting_details_left_apart_from_the_block_are_refused() {
    let saved = format!("<p>Agenda</p>{}", teams_block());
    let edited = format!(
        "<p>Meeting ID: 123 456 789 0<br>Passcode: abc123</p><p>Notes</p>{}",
        rewritten_block()
    );

    assert!(without_meeting(&edited, &saved, JOIN).is_err());
}

#[test]
fn an_image_the_person_put_in_a_meeting_paragraph_is_refused_not_dropped() {
    let saved = format!("<p>Agenda</p>{}", teams_block());
    let edited = rewritten_block().replace(
        "<p>Microsoft Teams meeting</p>",
        "<p>Microsoft Teams meeting<img src=\"https://example.com/diagram.png\"></p>",
    );

    assert!(without_meeting(&format!("<p>Notes</p>{edited}"), &saved, JOIN).is_err());
}

#[test]
fn the_saved_block_goes_back_where_the_rewritten_one_was() {
    let saved = format!("<p>Agenda</p>{}", teams_block());
    let edited = format!("<p>Before</p>{}<p>After</p>", rewritten_block());

    assert_eq!(
        with_saved_meeting(&edited, &saved, JOIN).unwrap(),
        format!("<p>Before</p>{}<p>After</p>", teams_block())
    );
}

#[test]
fn a_description_too_large_to_parse_is_refused_not_kept() {
    let saved = format!("<p>Agenda</p>{}", teams_block());
    let (_, crafted, _) = crafted_bodies().remove(0);
    let edited = format!("{}{crafted}", rewritten_block());

    let error = with_saved_meeting(&edited, &saved, JOIN).unwrap_err();

    assert!(error.is_refused());
}

#[test]
fn an_image_the_person_adds_inside_a_block_with_its_own_image_is_kept() {
    let href = JOIN.replace('&', "&amp;");
    let logo = "https://statics.teams.example/logo.png";
    let block = format!(
        "<div class=\"me-email-text\"><div><img src=\"{logo}\"></div><div><a href=\"{href}\">Join the meeting now</a></div><div><span>Meeting ID: 123</span></div></div>"
    );
    let saved = format!("<p>Agenda</p>{block}");
    let rewritten = format!(
        "<p><img src=\"{logo}\"></p><p><a href=\"{href}\">Join the meeting now</a></p><p><img src=\"https://example.com/diagram.png\"></p><p>Meeting ID: 123</p>"
    );

    // The person's image splits the block, so it cannot be separated.
    assert!(with_saved_meeting(&rewritten, &saved, JOIN).is_err());
    // Teams' own image is still the block's.
    let own = format!(
        "<p>Notes</p><p><img src=\"{logo}\"></p><p><a href=\"{href}\">Join the meeting now</a></p><p>Meeting ID: 123</p>"
    );
    assert_eq!(
        with_saved_meeting(&own, &saved, JOIN).unwrap(),
        format!("<p>Notes</p>{block}")
    );
}

#[test]
fn an_image_the_person_puts_beside_the_join_link_is_kept() {
    let href = JOIN.replace('&', "&amp;");
    let logo = "https://statics.teams.example/logo.png";
    let block = format!(
        "<div class=\"me-email-text\"><div><a href=\"{href}\"><img src=\"{logo}\">Join the meeting now</a></div><div><span>Meeting ID: 123</span></div></div>"
    );
    let saved = format!("<p>Agenda</p>{block}");
    let rewritten = format!(
        "<p><a href=\"{href}\"><img src=\"https://example.com/diagram.png\">Join the meeting now</a></p><p>Meeting ID: 123</p>"
    );
    assert!(with_saved_meeting(&rewritten, &saved, JOIN).is_err());

    let own = format!(
        "<p>Notes</p><p><a href=\"{href}\"><img src=\"{logo}\">Join the meeting now</a></p><p>Meeting ID: 123</p>"
    );
    assert_eq!(
        with_saved_meeting(&own, &saved, JOIN).unwrap(),
        format!("<p>Notes</p>{block}")
    );
}

#[test]
fn media_without_a_source_is_never_the_blocks() {
    let href = JOIN.replace('&', "&amp;");
    let saved = format!(
        "<p>Agenda</p><div class=\"me-email-text\"><div><svg></svg></div><div><a href=\"{href}\">Join the meeting now</a></div><div><svg></svg></div><div><span>Meeting ID: 123</span></div></div>"
    );
    let rewritten = format!(
        "<p><a href=\"{href}\">Join the meeting now</a></p><p><img srcset=\" \"></p><p>Meeting ID: 123</p>"
    );

    assert!(with_saved_meeting(&rewritten, &saved, JOIN).is_err());
}

#[test]
fn only_outermost_provider_blocks_are_split_in_document_order() {
    let first = format!(
        "<div class=\"me-email-text\"><a href=\"{}\">Join</a><div class=\"me-email-inner\">PIN 1</div></div>",
        JOIN.replace('&', "&amp;")
    );
    let second = "<div class=\"me-email-footer\">Options</div>";
    // Inside a provider-owned element that is not a `div`, a block is part
    // of that element rather than a block of its own.
    let inside_span =
        "<span class=\"me-email-x\"><div class=\"me-email-text\">Dial in</div></span>";
    let body = format!("<p>Before</p>{first}<div><p>Notes</p>{second}</div>{inside_span}");

    let (description, meeting) = split(&body, JOIN).unwrap();

    assert_eq!(meeting, format!("{first}{second}"));
    assert_eq!(
        description,
        format!("<p>Before</p><div><p>Notes</p></div>{inside_span}")
    );
}

#[test]
fn blocks_moved_by_the_parser_are_split_in_document_order() {
    let join = JOIN.replace('&', "&amp;");
    // A `div` inside a table but outside its cells is moved before the
    // table, after the cell's `div` was created.
    let body = format!(
        "<table><tr><td><div class=\"me-email-a\">A <a href=\"{join}\">Join</a></div></td></tr><div class=\"me-email-b\">B</div></table>"
    );

    let (description, meeting) = split(&body, JOIN).unwrap();

    assert_eq!(
        meeting,
        format!(
            "<div class=\"me-email-b\">B</div><div class=\"me-email-a\">A <a href=\"{join}\">Join</a></div>"
        )
    );
    assert_eq!(
        description,
        "<table><tbody><tr><td></td></tr></tbody></table>"
    );
}

#[test]
fn a_provider_class_on_the_html_tag_marks_no_block() {
    // A fragment parse merges `<html>`'s attributes into its root element,
    // which holds everything and is no block of its own.
    let body = format!(
        "<html class=\"me-email-x\"><body>{}</body></html>",
        teams_block()
    );

    assert!(split(&body, JOIN).is_err());
}

/// Bodies whose parse would build far more than `bounded_html` allows, each
/// after a meeting block the split would otherwise find, and the most memory
/// its refusal may take.
fn crafted_bodies() -> Vec<(&'static str, String, usize)> {
    // Each `<p>` closes the paragraph holding the 1,000 still-active `<b>`s,
    // and the parser rebuilds them all inside the next one: 13 KB that
    // builds a million nodes.
    let distinct_bold: String = (0..1_000).map(|i| format!("<b id={i}>")).collect();
    vec![
        // The node limit itself: 69 MB.
        (
            "paragraphs",
            "<p>x</p>".repeat(bounded_html::MAX_HTML_NODES),
            96 << 20,
        ),
        (
            "distinct bold",
            format!("<p>{distinct_bold}{}", "<p>x".repeat(1_000)),
            8 << 20,
        ),
        (
            "nested divs",
            format!("{}{}", "<div>".repeat(40_000), "</p>".repeat(40_000)),
            8 << 20,
        ),
        (
            "long title on rebuilt bold",
            format!(
                "<p>{}{}",
                (0..5)
                    .map(|i| format!("<b id={i} title=\"{}\">", "a".repeat(4_000)))
                    .collect::<String>(),
                "<p>x".repeat(50_000)
            ),
            8 << 20,
        ),
    ]
}

#[test]
fn a_crafted_body_is_refused_in_bounded_memory() {
    for (name, crafted, most) in crafted_bodies() {
        let body = format!("{}{crafted}", teams_block());
        let mut result = None;

        let peak = peak_bytes_during(|| result = Some(split(&body, JOIN)));

        let error = result.unwrap().expect_err(name);
        assert_eq!(error.message(), TOO_LARGE, "{name}");
        assert!(error.is_refused(), "{name}");
        // Parsed whole, the rebuilt bold peaked at 326 MB and 1.7 GB and the
        // nested divs took minutes.
        assert!(
            peak < most,
            "{peak} bytes to split {} bytes of {name}",
            body.len()
        );
    }
}

#[test]
fn markup_inside_noscript_stays_text_through_the_split() {
    // With scripting on, as `bounded_html` parses, `<noscript>` holds text:
    // this is one node. A second parse of the raw body with scripting off
    // (html2text's) would build the million nodes the crafted markup asks for.
    let (_, crafted, _) = crafted_bodies()
        .into_iter()
        .find(|(name, _, _)| *name == "distinct bold")
        .unwrap();
    let body = format!("<noscript>{crafted}</noscript>{}", teams_block());
    let mut result = None;

    let peak = peak_bytes_during(|| result = Some(split(&body, JOIN)));

    let (description, meeting) = result.unwrap().unwrap();
    assert_eq!(meeting, teams_block());
    // Written back as escaped text, which no reader parses as tags.
    assert_eq!(
        description,
        format!(
            "<noscript>{}</noscript>",
            crafted.replace('<', "&lt;").replace('>', "&gt;")
        )
    );
    assert!(peak < 4 << 20, "{peak} bytes to split {} bytes", body.len());
}
