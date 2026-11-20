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

/// Bodies whose parse would build far more than `bounded_html` allows, each
/// after a meeting block the split would otherwise find.
fn crafted_bodies() -> Vec<(&'static str, String)> {
    // Each `<p>` closes the paragraph holding the 1,000 still-active `<b>`s,
    // and the parser rebuilds them all inside the next one: 13 KB that
    // builds a million nodes.
    let distinct_bold: String = (0..1_000).map(|i| format!("<b id={i}>")).collect();
    vec![
        (
            "paragraphs",
            "<p>x</p>".repeat(bounded_html::MAX_HTML_NODES),
        ),
        (
            "distinct bold",
            format!("<p>{distinct_bold}{}", "<p>x".repeat(1_000)),
        ),
        (
            "nested divs",
            format!("{}{}", "<div>".repeat(40_000), "</p>".repeat(40_000)),
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
        ),
    ]
}

#[test]
fn a_crafted_body_is_refused_in_bounded_memory() {
    for (name, crafted) in crafted_bodies() {
        let body = format!("{}{crafted}", teams_block());
        let mut result = None;

        let peak = peak_bytes_during(|| result = Some(split(&body, JOIN)));

        let error = result.unwrap().expect_err(name);
        assert_eq!(error.message(), TOO_LARGE, "{name}");
        // Parsed whole, the rebuilt bold peaked at 326 MB and 1.7 GB and the
        // nested divs took minutes; clipped, the node limit itself peaks at
        // 69 MB and the rest below 4 MB.
        assert!(
            peak < 96 << 20,
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
    let (_, crafted) = crafted_bodies()
        .into_iter()
        .find(|(name, _)| *name == "distinct bold")
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
