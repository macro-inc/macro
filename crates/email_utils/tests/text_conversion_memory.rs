//! Converting an HTML body to text must cost memory in proportion to the
//! HTML, or refuse. Laid out in columns, html2text padded every table row to
//! the width of its longest cell, and it copies a table's column widths into
//! every row, so a few kilobytes of tables once held gigabytes per message.
//!
//! Sanitizing a body and finding its reply parse it with html5ever, whose
//! memory follows the nodes it builds rather than the bytes it reads, so the
//! parse stops at a node and a depth limit.

use email_utils::body_parsed::{compute_body_parsed, html_to_plaintext};
use email_utils::body_replyless::{compute_body_replyless, reply_snippet};
use email_utils::bounded_html::MAX_HTML_NODES;
use email_utils::sanitize_email_html;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

/// Counts the heap bytes each thread holds, so tests running in parallel
/// measure only their own conversion.
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

/// Bytes the conversion held at its peak, beyond what was held before it.
fn peak_bytes_during(convert: impl FnOnce()) -> usize {
    let before = LIVE_BYTES.with(Cell::get);
    PEAK_BYTES.with(|peak| peak.set(before));
    convert();
    PEAK_BYTES.with(Cell::get) - before
}

#[test]
fn a_table_with_one_long_cell_converts_in_bounded_memory() {
    // A long paragraph and a long unbroken token (a URL, an encoded blob)
    // each set a column's width; 2,000 short rows below it are padded to it.
    for long_cell in ["word ".repeat(4_000), "a".repeat(20_000)] {
        let mut html = format!("<table><tr><td>{long_cell}</td><td>x</td></tr>");
        for _ in 0..2_000 {
            html.push_str("<tr><td>b</td><td>c</td></tr>");
        }
        html.push_str("</table>");
        let body = Some(html.clone());
        let cell_start = &long_cell[..19];

        let plaintext = peak_bytes_during(|| {
            let text = html_to_plaintext(&html).expect("the table converts");
            assert!(text.contains(cell_start));
        });
        let parsed = peak_bytes_during(|| {
            let text = compute_body_parsed(true, &body).expect("the table converts");
            assert!(text.contains(cell_start));
        });
        let snippet = peak_bytes_during(|| {
            assert!(reply_snippet(None, Some(&html), None).is_some());
        });

        // About 80 KB of HTML; laid out in columns, each conversion peaked
        // above 140 MB.
        for peak in [plaintext, parsed, snippet] {
            assert!(
                peak < 32 << 20,
                "{peak} bytes to convert {} bytes of HTML",
                html.len()
            );
        }
    }
}

#[test]
fn a_table_with_one_very_wide_row_over_many_rows_is_refused_cheaply() {
    // Every row holds a copy of the widest row's column widths: 4,000 rows
    // below a row of 4,000 cells.
    let html = format!(
        "<table><tr>{}{}</table>",
        "<td>x".repeat(4_000),
        "<tr>".repeat(4_000)
    );
    let mut text = Some(String::new());

    let peak = peak_bytes_during(|| text = html_to_plaintext(&html));

    // About 36 KB of HTML that peaked above 130 MB when laid out.
    assert_eq!(text, None);
    assert!(
        peak < 32 << 20,
        "{peak} bytes to refuse {} bytes of HTML",
        html.len()
    );
}

#[test]
fn spanning_cells_convert_in_bounded_memory() {
    // A rowspan reaching past every later row adds a filler cell to each of
    // them, and colspans add columns that every row then copies: neither is
    // a cell in the HTML.
    let rowspans = format!("<table>{}</table>", "<tr><td rowspan=99999>x".repeat(1_000));
    let colspans = format!(
        "<table>{}</table>",
        (1..=4_000)
            .map(|span| format!("<tr><td colspan={span}>a<td>b"))
            .collect::<String>()
    );

    for html in [rowspans, colspans] {
        let mut text = None;

        let peak = peak_bytes_during(|| text = html_to_plaintext(&html));

        assert!(text.is_some());
        // Kept, the spans made each of these peak above 100 MB.
        assert!(
            peak < 32 << 20,
            "{peak} bytes to convert {} bytes of HTML",
            html.len()
        );
    }
}

#[test]
fn deep_nesting_is_refused_cheaply() {
    // Every quote or list level prefixes each line inside it. Past the width,
    // the innermost text wraps every few characters, and each of those lines
    // carries the whole prefix.
    let quotes = format!("{}{}", "<blockquote>".repeat(1_000), "ab ".repeat(40_000));
    // Within the parse's node limit, so the prefix width refuses them.
    let lists = format!(
        "{}{}",
        "<ol start=999999999><li>".repeat(128),
        "x<br>".repeat(20_000)
    );
    // Only 64 levels, but each numbers its lines with 19 digits.
    let numbers = format!(
        "{}{}",
        "<ol start=9223372036854775807><li>".repeat(64),
        "x<br>".repeat(20_000)
    );

    for html in [quotes, lists, numbers] {
        let mut text = Some(String::new());

        let peak = peak_bytes_during(|| text = html_to_plaintext(&html));

        assert_eq!(text, None);
        // Laid out, each of these peaked above 200 MB.
        assert!(
            peak < 32 << 20,
            "{peak} bytes to refuse {} bytes of HTML",
            html.len()
        );
    }
}

#[test]
fn a_body_that_builds_past_the_parse_limits_gets_no_text_cheaply() {
    let distinct_bold: String = (0..1_000).map(|i| format!("<b id={i}>")).collect();
    let formatting = [
        "b", "big", "code", "em", "font", "i", "s", "small", "strike", "strong", "tt", "u",
    ]
    .map(|name| format!("<{name}>").repeat(3))
    .concat();
    let quoted_titles: String = (0..5)
        .map(|i| format!("<b id={i} title='{}'>", "\"".repeat(4_000)))
        .collect();
    // Each body with the number of `x`s in its text.
    let shallow = [
        // Each `<p>` closes the paragraph holding the bold tags, and html5ever
        // rebuilds them all inside the next: 13 KB that built a million nodes
        // and took 2.5 GB to convert.
        (format!("<p>{distinct_bold}{}", "<p>x".repeat(1_000)), 1_000),
        (format!("<p>{formatting}{}", "<p>x".repeat(60_000)), 60_000),
        (
            format!("<p>{quoted_titles}{}", "<p>x".repeat(50_000)),
            50_000,
        ),
        // Each `</p>` scans the open elements for a paragraph: 28 s to parse.
        (
            format!("{}{}", "<div>".repeat(40_000), "</p>".repeat(40_000)),
            0,
        ),
        // Three identical bold tags rebuilt per paragraph stay within the
        // sanitizer's node limit, but took html2text 457 MB.
        (format!("<p><b><b><b>{}", "<p>x".repeat(49_000)), 49_000),
    ];
    // html2text parses `<noscript>` with scripting off and `<select>` with a
    // newer html5ever, so a check that read them otherwise let these through
    // at full cost. Scripting off, `<noscript>` holds the same markup; inside
    // `<select>` the bounded parse keeps only the text, and html2text reads
    // that tree, so it converts cheaply to the body's `x`s, run together.
    let refused = shallow.iter().map(|(body, _)| (body.clone(), None)).chain(
        shallow
            .iter()
            .map(|(body, _)| (format!("<noscript>{body}</noscript>"), None)),
    );
    let selects = shallow
        .iter()
        .map(|(body, xs)| (format!("<select>{body}"), Some(*xs)));

    for (html, expected_xs) in refused.chain(selects) {
        let body = Some(html.clone());
        let mut texts = (Some(String::new()), Some(String::new()));
        let started = std::time::Instant::now();

        let peak = peak_bytes_during(|| {
            texts = (html_to_plaintext(&html), compute_body_parsed(true, &body));
        });

        match expected_xs {
            None => assert_eq!(texts, (None, None)),
            Some(xs) => {
                let expected = Some("x".repeat(xs));
                assert_eq!(texts, (expected.clone(), expected));
            }
        }
        assert!(
            peak < 32 << 20,
            "{peak} bytes to convert {} bytes of HTML",
            html.len()
        );
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "{:?} to convert {} bytes of HTML",
            started.elapsed(),
            html.len()
        );
    }
}

#[test]
fn a_legacy_doctype_body_converts_in_its_own_quirks_mode() {
    // In quirks mode a paragraph stays open around a table; read again in
    // no-quirks mode, each table closes it and rebuilds the bold tags around
    // it, which took twice the memory: 194 MB against 98 MB.
    let bold: String = (0..31).map(|i| format!("<b id={i}>")).collect();
    let html = format!(
        r#"<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><p>{bold}{}"#,
        "<p>z<table></table>y".repeat(1_200)
    );
    let mut text = None;

    let peak = peak_bytes_during(|| text = html_to_plaintext(&html));

    assert!(text.is_some());
    assert!(
        peak < 128 << 20,
        "{peak} bytes to convert {} bytes of HTML",
        html.len()
    );
}

/// Bodies whose parse would build far more than the node limit, or nest
/// past the depth limit.
fn oversized_bodies() -> Vec<(&'static str, String)> {
    let distinct_bold: String = (0..1_000).map(|i| format!("<b id={i}>")).collect();
    let formatting = [
        "b", "big", "code", "em", "font", "i", "s", "small", "strike", "strong", "tt", "u",
    ]
    .map(|name| format!("<{name}>").repeat(3))
    .concat();
    vec![
        ("paragraphs", "<p>x</p>".repeat(MAX_HTML_NODES)),
        ("images", "<img src=x>".repeat(2 * MAX_HTML_NODES)),
        ("line breaks", "<br>x".repeat(MAX_HTML_NODES)),
        // Each `<p>` closes the paragraph holding formatting elements that
        // are still active, and the parser rebuilds them all inside the next
        // one: 13 KB that builds a million nodes. Identical tags are kept
        // three at a time.
        (
            "distinct bold",
            format!("<p>{distinct_bold}{}", "<p>x".repeat(1_000)),
        ),
        (
            "formatting",
            format!("<p>{formatting}{}", "<p>x".repeat(60_000)),
        ),
        (
            "nested bold",
            (0..10_000).map(|i| format!("<b id={i}>")).collect(),
        ),
        (
            "nested divs",
            format!("{}{}", "<div>".repeat(40_000), "</p>".repeat(40_000)),
        ),
        // Each new `<b>` is compared with every open one, sorting both
        // attribute lists, while the nesting stays put.
        (
            "bold pairs",
            format!(
                "<p>{}{}",
                (0..100)
                    .map(|i| format!("<b id={i}{}>", attribute_list(8)))
                    .collect::<String>(),
                (0..5_000)
                    .map(|i| format!("</b><b id=p{i}{}>", attribute_list(8)))
                    .collect::<String>()
            ),
        ),
        // Each rebuilt element copies its attributes.
        (
            "attributes on rebuilt bold",
            format!(
                "<p>{}{}",
                (0..100)
                    .map(|i| format!("<b id={i}{}>", attribute_list(100)))
                    .collect::<String>(),
                "<p>x".repeat(500)
            ),
        ),
        // Rebuilt elements share their attributes in the tree, but a
        // serialization writes each copy out: 214 KB that serialized to
        // 700 MB.
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
        // Serialized, each `"` in a value is written as `&quot;`: counted as
        // read, this stored 96 MB.
        (
            "quoted title on rebuilt bold",
            format!(
                "<p>{}{}",
                (0..5)
                    .map(|i| format!("<b id={i} title='{}'>", "\"".repeat(4_000)))
                    .collect::<String>(),
                "<p>x".repeat(50_000)
            ),
        ),
        // Each `<body>` adds its attributes to the one body element.
        (
            "repeated body attributes",
            (0..5_000).map(|i| format!("<body a{i}>")).collect(),
        ),
    ]
}

/// ` a0 a1 …`: attributes without values.
fn attribute_list(count: usize) -> String {
    (0..count).map(|i| format!(" a{i}")).collect()
}

#[test]
fn an_oversized_body_sanitizes_in_bounded_memory() {
    for (name, html) in oversized_bodies() {
        let mut sanitized = String::new();

        let peak = peak_bytes_during(|| sanitized = sanitize_email_html(&html));

        assert!(sanitized.ends_with("read the original.</p>"), "{name}");
        // Parsed whole, the shallow ones peaked between 138 MB and 3 GB and
        // the nested ones took seconds; clipped, none peaks above 82 MB.
        assert!(
            peak < 128 << 20,
            "{peak} bytes to sanitize {} bytes of {name}",
            html.len()
        );
        // What is stored and parsed again on every thread read.
        assert!(
            sanitized.len() < 24 << 20,
            "{} bytes sanitized from {name}",
            sanitized.len()
        );
    }
}

#[test]
fn an_oversized_body_keeps_its_reply_whole_in_bounded_memory() {
    for (name, body) in oversized_bodies() {
        let html = format!("{body}<blockquote>Quoted</blockquote>");
        let mut reply = None;

        let peak = peak_bytes_during(|| reply = compute_body_replyless(None, Some(&html), None));

        assert_eq!(reply.as_deref(), Some(html.as_str()), "{name}");
        // Parsed whole, the shallow ones peaked between 232 MB and 1.9 GB.
        assert!(
            peak < 128 << 20,
            "{peak} bytes to keep {} bytes of {name}",
            html.len()
        );
    }
}

#[test]
fn a_reply_is_found_in_bounded_memory_just_under_the_node_limit() {
    let html = format!(
        "{}<blockquote>Quoted</blockquote>",
        "<br>x".repeat(MAX_HTML_NODES / 2 - 10)
    );
    let mut reply = None;

    let peak = peak_bytes_during(|| reply = compute_body_replyless(None, Some(&html), None));

    let reply = reply.expect("html");
    assert!(reply.ends_with('x') && !reply.contains("Quoted"));
    // Checking each cut for visible content parses it while the document is
    // still held: about 116 MB at the limit.
    assert!(
        peak < 160 << 20,
        "{peak} bytes to find the reply in {} bytes of HTML",
        html.len()
    );
}

#[test]
fn parse_errors_cost_no_memory() {
    // Each NUL is a parse error that builds nothing; kept, 5 MB of them
    // peaked at 581 MB.
    let html = format!("<p>x</p>{}", "\0".repeat(5 << 20));
    let mut sanitized = String::new();
    let mut reply = None;

    let sanitize_peak = peak_bytes_during(|| sanitized = sanitize_email_html(&html));
    let reply_peak = peak_bytes_during(|| reply = compute_body_replyless(None, Some(&html), None));

    assert_eq!(sanitized, "<p>x</p>");
    assert!(reply.is_some());
    for peak in [sanitize_peak, reply_peak] {
        assert!(
            peak < 32 << 20,
            "{peak} bytes for {} bytes of HTML",
            html.len()
        );
    }
}
