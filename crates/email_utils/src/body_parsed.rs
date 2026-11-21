use html2text::config::Config;
use html2text::render::PlainDecorator;
use html2text::{Element, Handle};
use html5ever::tree_builder::QuirksMode;
use scraper::Html;

/// The line width html2text lays a body out at: wider than any line the first
/// `MAX_HTML_BYTES` of HTML can make, so no text wraps. In raw mode nothing
/// is padded to the width, so its size costs nothing; it stays finite because
/// html2text adds widths up as it places a table's cells.
const TEXT_WIDTH: usize = 4 * MAX_HTML_BYTES;

/// The most table cells a body may lay out, counted as each table's rows
/// times its widest row. html2text gives every row its own copy of its
/// table's column widths, so a table of many rows below one very wide row
/// costs that product in memory. A body past it gets no text.
const MAX_TABLE_CELLS: usize = 1_000_000;

/// The most columns of prefix the quotes, lists, definitions and headings
/// around a line may give it: 64 levels of a two-column quote or bullet.
/// html2text prefixes every line inside each of them and copies the lines at
/// every level, so its output grows with lines times prefix width, and an
/// ordered list starting at a 19-digit number prefixes 21 columns. A body
/// past it gets no text.
const MAX_INDENT: usize = 128;

/// The most HTML a conversion reads; a longer body's text stops there.
/// html2text's document tree takes up to about 500 bytes per byte of HTML,
/// so this caps a conversion near 250 MB.
const MAX_HTML_BYTES: usize = 512 * 1024;

/// The most nodes a conversion's bounded parse may build, below the
/// sanitizer's limit: html2text's tree and render take 1.3 to 1.9 KB a node,
/// so this keeps a conversion near 120 MB. Real mail within `MAX_HTML_BYTES`
/// builds far fewer. A body past it gets no text.
const MAX_TEXT_NODES: usize = 64_000;

/// Convert `body_replyless` into plaintext with link footnotes.
///
/// If the original message had no HTML body, `body_replyless` is already plaintext.
/// Otherwise it's HTML and is parsed to plaintext using `html2text`: only its
/// first `MAX_HTML_BYTES`, and `None` when it cannot be converted, its tables
/// or nesting are too large to, or it builds past a limit of
/// [`crate::bounded_html`].
pub fn compute_body_parsed(has_html: bool, body_replyless: &Option<String>) -> Option<String> {
    let text = body_replyless.as_ref()?;

    if !has_html {
        return Some(text.clone());
    }

    let config = html2text::config::plain()
        .no_table_borders()
        .link_footnotes(true);

    parse_html_to_text(text, config)
}

/// Convert `body_replyless` into plaintext without link footnotes or brackets.
///
/// Same as [`compute_body_parsed`] but strips link wrapping and square brackets,
/// producing cleaner text for search indexing.
pub fn compute_body_parsed_linkless(
    has_html: bool,
    body_replyless: &Option<String>,
) -> Option<String> {
    let text = body_replyless.as_ref()?;

    if !has_html {
        return Some(text.clone());
    }

    let config = html2text::config::plain()
        .no_table_borders()
        .link_footnotes(false)
        .no_link_wrapping();

    parse_html_to_text(text, config).map(|mut text| {
        text.retain(|c| c != '[' && c != ']');
        text
    })
}

/// Convert an HTML fragment to block-aware plaintext: block elements and table
/// cells are separated by newlines, but inline runs (`<strong>`, `<em>`, `<a>`,
/// …) stay on one line. Returns `None` if conversion fails, the fragment's
/// tables or nesting are too large to convert, or it builds past a limit of
/// [`crate::bounded_html`]. Suitable for building a
/// `text/plain` MIME alternative from a small HTML snippet (e.g. a signature).
pub fn html_to_plaintext(html: &str) -> Option<String> {
    let config = html2text::config::plain()
        .no_table_borders()
        .link_footnotes(false)
        .no_link_wrapping();

    parse_html_to_text(html, config)
}

/// Convert an HTML fragment to the words a reader sees: like
/// [`html_to_plaintext`], with no emphasis marks for bold or italic text and,
/// as in [`compute_body_parsed_linkless`], no square brackets. Suitable for
/// previewing a message in a line of UI.
pub fn html_to_undecorated_text(html: &str) -> Option<String> {
    let config = html2text::config::plain_no_decorate()
        .no_table_borders()
        .link_footnotes(false)
        .no_link_wrapping();

    parse_html_to_text(html, config).map(|mut text| {
        text.retain(|c| c != '[' && c != ']');
        text
    })
}

fn parse_html_to_text(html: &str, config: Config<PlainDecorator>) -> Option<String> {
    // Raw mode stacks a table's cells in reading order instead of laying them
    // out in columns. Laid out, a column was as wide as its longest cell and
    // every row was padded to it, so one long cell over many rows took
    // gigabytes, and wrapped cells interleaved their lines.
    let config = config.raw_mode(true).allow_width_overflow();
    if html.len() > MAX_HTML_BYTES {
        tracing::info!(
            html_len = html.len(),
            "converting the start of an email body longer than the text limit"
        );
    }
    let html = &html[..html.floor_char_boundary(MAX_HTML_BYTES)];
    // html2text builds its tree with html5ever, which rebuilds every
    // still-active formatting element inside each new paragraph: 13 KB can
    // build a million nodes. The bounded parse finds such a body first, and
    // one past its limits gets no text. html2text then reads the bounded
    // tree's serialization, never the body: it parses with a newer html5ever
    // whose rules differ (inside `<select>`, for one), and a well-formed
    // serialization, parsed in the same quirks mode, builds it no more than
    // the bounded parse did.
    let parsed = crate::bounded_html::parse_document_for_text(html, MAX_TEXT_NODES);
    if parsed.clipped {
        tracing::warn!(
            html_len = html.len(),
            "email body builds too much to convert to text"
        );
        return None;
    }
    let html = serialize_in_its_quirks_mode(&parsed.html);
    drop(parsed);
    // html2text panics on some malformed-but-real email HTML (e.g. a table
    // rowspan overhanging past the last row). A panic here takes down the
    // whole message-processing worker, so contain it and treat the body as
    // unparseable instead.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let dom = config.parse_html(html.as_bytes())?;
        let layout = strip_spans_and_measure(&dom.document);
        if layout.table_cells > MAX_TABLE_CELLS || layout.indent > MAX_INDENT {
            tracing::warn!(
                html_len = html.len(),
                table_cells = layout.table_cells,
                indent = layout.indent,
                "email body is too large to lay out as text"
            );
            return Ok(None);
        }
        let tree = config.dom_to_render_tree(&dom)?;
        config.render_to_string(tree, TEXT_WIDTH).map(Some)
    }))
    .inspect_err(|_| {
        tracing::warn!(
            html_len = html.len(),
            "html2text panicked converting email body"
        );
    });
    match result {
        Ok(Ok(Some(text))) => {
            let trimmed = text
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .collect::<Vec<&str>>()
                .join("\n");
            Some(trimmed)
        }
        Ok(Ok(None) | Err(_)) | Err(_) => None,
    }
}

/// A doctype html5ever reads in limited-quirks mode.
const LIMITED_QUIRKS_DOCTYPE: &str =
    r#"<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">"#;

/// The document as HTML that parses in its own quirks mode. Scraper writes
/// any doctype as `<!DOCTYPE html>`, so a page with a legacy doctype (common
/// in Outlook mail) would be read again in no-quirks mode, where a paragraph
/// before a table closes and the formatting around it is rebuilt: a
/// different tree, and twice as large for crafted HTML.
fn serialize_in_its_quirks_mode(document: &Html) -> String {
    match document.quirks_mode {
        QuirksMode::NoQuirks => document.html(),
        // A document without a doctype parses in quirks mode.
        QuirksMode::Quirks => document.root_element().html(),
        QuirksMode::LimitedQuirks => {
            format!("{LIMITED_QUIRKS_DOCTYPE}{}", document.root_element().html())
        }
    }
}

/// What sizes html2text's work on a document.
struct Layout {
    /// Each table's rows times its widest row, summed over the document.
    table_cells: usize,
    /// The widest prefix the quotes, lists, definitions and headings around
    /// any node give its lines, in columns.
    indent: usize,
}

/// Drops every cell's `rowspan` and `colspan`, and measures the document's
/// [`Layout`]. Raw mode stacks the cells, so a span changes no text, but
/// html2text still adds a filler cell to every row a rowspan covers and
/// widens a spanning cell; without spans, rows times widest row is the column
/// widths html2text copies into rows. The indent adds up the prefixes
/// html2text gives the lines inside `blockquote` ("> "), `ul` ("* "), `dd`
/// (two spaces), headings (one `#` per level and a space) and `ol` (its
/// widest number and ". "). The walk keeps a stack rather than recursing,
/// because nesting depth is the sender's choice; each node waits with the
/// table its rows belong to and the indent around it.
fn strip_spans_and_measure(document: &Handle) -> Layout {
    let mut tables: Vec<(usize, usize)> = Vec::new();
    let mut widest_indent = 0;
    let mut pending: Vec<(Handle, Option<usize>, usize)> = vec![(document.clone(), None, 0)];
    while let Some((node, table, indent)) = pending.pop() {
        let mut children_table = table;
        let mut children_indent = indent;
        if let Element { name, attrs, .. } = &node.data {
            let prefix = match &*name.local {
                "blockquote" | "ul" | "dd" | "h1" => 2,
                "h2" => 3,
                "h3" => 4,
                "h4" => 5,
                "h5" => 6,
                "h6" => 7,
                "ol" => {
                    let start = attrs
                        .borrow()
                        .iter()
                        .find(|attr| &*attr.name.local == "start")
                        .and_then(|attr| attr.value.parse::<i64>().ok())
                        .unwrap_or(1);
                    let items = node
                        .children
                        .borrow()
                        .iter()
                        .filter(|child| match &child.data {
                            Element { name, .. } => &*name.local == "li",
                            _ => false,
                        })
                        .count();
                    let last = start
                        .saturating_add(i64::try_from(items).unwrap_or(i64::MAX))
                        .saturating_sub(1);
                    start.to_string().len().max(last.to_string().len()) + 2
                }
                _ => 0,
            };
            children_indent = indent.saturating_add(prefix);
            widest_indent = widest_indent.max(children_indent);
            match &*name.local {
                "table" => {
                    children_table = Some(tables.len());
                    tables.push((0, 0));
                }
                "tr" => {
                    let cells = node
                        .children
                        .borrow()
                        .iter()
                        .filter(|child| match &child.data {
                            Element { name, .. } => matches!(&*name.local, "td" | "th"),
                            _ => false,
                        })
                        .count();
                    if let Some((rows, widest)) = table.and_then(|index| tables.get_mut(index)) {
                        *rows += 1;
                        *widest = (*widest).max(cells);
                    }
                }
                "td" | "th" => attrs
                    .borrow_mut()
                    .retain(|attr| !matches!(&*attr.name.local, "rowspan" | "colspan")),
                _ => {}
            }
        }
        for child in node.children.borrow().iter() {
            pending.push((child.clone(), children_table, children_indent));
        }
    }
    Layout {
        table_cells: tables.iter().fold(0, |total, (rows, widest)| {
            total.saturating_add(rows.saturating_mul(*widest))
        }),
        indent: widest_indent,
    }
}

#[cfg(test)]
mod test;
