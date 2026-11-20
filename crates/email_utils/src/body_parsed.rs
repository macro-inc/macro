use html2text::config::Config;
use html2text::render::PlainDecorator;
use html2text::{Element, Handle};

/// The line width html2text lays a body out at. Longer paragraphs wrap onto
/// new lines; content that cannot fit, such as deeply nested quotes,
/// overflows the width instead of failing the conversion.
const TEXT_WIDTH: usize = 1_000;

/// The most table cells a body may lay out, counted as each table's rows
/// times its widest row. html2text gives every row its own copy of its
/// table's column widths, so a table of many rows below one very wide row
/// costs that product in memory. A body past it gets no text.
const MAX_TABLE_CELLS: usize = 1_000_000;

/// The most HTML a conversion reads; a longer body's text stops there.
/// html2text's document tree takes up to a few hundred bytes per byte of
/// HTML, so this caps a conversion near a few hundred megabytes.
const MAX_HTML_BYTES: usize = 1 << 20;

/// Convert `body_replyless` into plaintext with link footnotes.
///
/// If the original message had no HTML body, `body_replyless` is already plaintext.
/// Otherwise it's HTML and is parsed to plaintext using `html2text`: only its
/// first `MAX_HTML_BYTES`, and `None` when it cannot be converted or its tables
/// are too large to.
pub fn compute_body_parsed(has_html: bool, body_replyless: &Option<String>) -> Option<String> {
    let text = body_replyless.as_ref()?;

    if !has_html {
        return Some(text.clone());
    }

    let config = html2text::config::plain()
        .no_table_borders()
        .link_footnotes(true)
        .no_link_wrapping();

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
/// …) stay on one line up to 1,000 characters. Returns `None` if conversion
/// fails or the fragment's tables are too large to convert. Suitable for
/// building a `text/plain` MIME alternative from a small HTML snippet (e.g. a
/// signature).
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
    // html2text panics on some malformed-but-real email HTML (e.g. a table
    // rowspan overhanging past the last row). A panic here takes down the
    // whole message-processing worker, so contain it and treat the body as
    // unparseable instead.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let dom = config.parse_html(html.as_bytes())?;
        let table_cells = strip_spans_and_count_cells(&dom.document);
        if table_cells > MAX_TABLE_CELLS {
            tracing::warn!(
                html_len = html.len(),
                table_cells,
                "email body has too many table cells to convert to text"
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

/// Drops every cell's `rowspan` and `colspan`, and returns each table's rows
/// times its widest row, summed over the document. Raw mode stacks the cells,
/// so a span changes no text, but html2text still adds a filler cell to every
/// row a rowspan covers and widens a spanning cell; without spans, rows times
/// widest row is the column widths html2text copies into rows. The walk keeps
/// a stack rather than recursing, because nesting depth is the sender's
/// choice; each node waits with the table its rows belong to.
fn strip_spans_and_count_cells(document: &Handle) -> usize {
    let mut tables: Vec<(usize, usize)> = Vec::new();
    let mut pending: Vec<(Handle, Option<usize>)> = vec![(document.clone(), None)];
    while let Some((node, table)) = pending.pop() {
        let mut children_table = table;
        if let Element { name, attrs, .. } = &node.data {
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
            pending.push((child.clone(), children_table));
        }
    }
    tables.iter().fold(0, |total, (rows, widest)| {
        total.saturating_add(rows.saturating_mul(*widest))
    })
}

#[cfg(test)]
mod test;
