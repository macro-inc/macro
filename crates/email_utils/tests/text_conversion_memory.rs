//! Converting an HTML body to text must cost memory in proportion to the
//! HTML, or refuse. Laid out in columns, html2text padded every table row to
//! the width of its longest cell, and it copies a table's column widths into
//! every row, so a few kilobytes of tables once held gigabytes per message.

use email_utils::body_parsed::{compute_body_parsed, html_to_plaintext};
use email_utils::body_replyless::reply_snippet;
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
