use super::constants::*;
use ego_tree::{NodeId, NodeRef};
use scraper::{ElementRef, Html, Node};
use std::ops::Deref;
// --- Public API ---

/// Parses an email's HTML content and returns the cleaned, latest reply.
pub fn extract_reply_html(subject: Option<&str>, html_content: &str) -> String {
    let document = Html::parse_document(html_content);

    if subject.is_some() && subject.unwrap().starts_with("Fwd:") {
        // If it's a forward, the entire original HTML is the desired content.
        return html_content.to_string();
    }

    // A cut that leaves nothing visible is wrong (the reply itself sits inside
    // the splitter), so fall through to the next candidate. If every cut is
    // empty, assume the entire body is the reply.
    find_splitters(&document)
        .into_iter()
        .map(|cut| get_html_before_cut(&document, cut))
        .find(|reply| has_visible_content(reply))
        .unwrap_or_else(|| html_content.to_string())
}

/// Where the quoted thread starts: a node, and for a text node optionally the
/// byte offset inside it (the attribution can share a text node with the
/// reply, e.g. `See you then!<br>On Thu, ... wrote:`).
#[derive(Clone, Copy)]
struct Cut {
    node: NodeId,
    text_offset: Option<usize>,
}

impl From<ElementRef<'_>> for Cut {
    fn from(element: ElementRef<'_>) -> Self {
        Cut {
            node: element.id(),
            text_offset: None,
        }
    }
}

// --- Core Logic & Orchestration ---

/// Collects every splitter candidate and orders them by where they appear in
/// the document, earliest first.
fn find_splitters(document: &Html) -> Vec<Cut> {
    let candidates: Vec<Cut> = [
        find_gmail_splitter(document).map(Cut::from),
        find_outlook_splitter(document).map(Cut::from),
        find_yahoo_splitter(document).map(Cut::from),
        find_blockquote_splitter(document).map(Cut::from),
        find_text_based_splitter(document).map(Cut::from),
        find_on_wrote_text_splitter(document),
    ]
    .into_iter()
    .flatten()
    .collect();

    // A single depth-first traversal gives document order; an ancestor opens
    // before its descendants, so it sorts first.
    let mut ordered: Vec<Cut> = Vec::with_capacity(candidates.len());
    for edge in document.tree.root().traverse() {
        if let ego_tree::iter::Edge::Open(node) = edge {
            ordered.extend(candidates.iter().filter(|cut| cut.node == node.id()));
        }
    }
    ordered
}

// --- Specific Splitter-Finding Strategies ---

// a gmail splitter will have a div.gmail_quote that contains a gmail_attr inside of it.
fn find_gmail_splitter(document: &Html) -> Option<ElementRef<'_>> {
    let mut candidates = document.select(&GMAIL_QUOTE_SELECTOR);

    candidates.find(|quote_el| quote_el.select(&GMAIL_ATTR_SELECTOR).next().is_some())
}

fn find_yahoo_splitter(document: &Html) -> Option<ElementRef<'_>> {
    document.select(&YAHOO_SEPARATOR_SELECTOR).next()
}

fn find_outlook_splitter(document: &Html) -> Option<ElementRef<'_>> {
    // Check for high-confidence, explicit markers first.
    if let Some(hr) = document.select(&OUTLOOK_HR_SELECTOR).next() {
        return Some(hr);
    }
    if let Some(div) = document.select(&OUTLOOK_APPENDONSEND_SELECTOR).next() {
        return Some(div);
    }
    if let Some(container) = document.select(&OUTLOOK_REPLY_CONTAINER_SELECTOR).next() {
        return Some(container);
    }
    // Outlook mobile and Outlook on the web put a horizontal rule immediately
    // above `div#divRplyFwdMsg`. A later `border-top` "From:" block is usually a
    // quote nested inside that thread, so the rule has to win.
    if let Some(header) = document.select(&OUTLOOK_REPLY_HEADER_SELECTOR).next() {
        return Some(outlook_reply_header_splitter(header));
    }

    // Check for a bordered element containing the header text.
    for element in document.select(&ANY_ELEMENT_SELECTOR) {
        if let Some(style) = element.value().attr("style")
            && style.contains("border")
            && FROM_SENT_RE.is_match(&element.text().collect::<String>())
        {
            return Some(element);
        }
    }

    // As a final fallback, find the deepest element matching the text pattern.
    document
        .select(&ANY_ELEMENT_SELECTOR)
        .rfind(|el| FROM_SENT_RE.is_match(&el.text().collect::<String>()))
}

fn find_blockquote_splitter(document: &Html) -> Option<ElementRef<'_>> {
    if let Some(blockquote) = document.select(&BLOCKQUOTE_SELECTOR).next() {
        // Check if the node right before the blockquote is an "On... wrote:"
        // line. Only take the whole element when the attribution opens it;
        // otherwise it also holds reply text and the cut belongs inside it
        // (`find_on_wrote_text_splitter`).
        if let Some(prev_el) = find_prev_significant_sibling(blockquote)
            && ON_WROTE_RE
                .find(prev_el.text().collect::<String>().trim_start())
                .is_some_and(|m| m.start() == 0)
        {
            // If so, use that header as the splitter for a cleaner cut.
            return Some(prev_el);
        }
        // Otherwise, the blockquote itself is the splitter.
        return Some(blockquote);
    }
    None
}

fn find_text_based_splitter(document: &Html) -> Option<ElementRef<'_>> {
    // Iterate over likely block-level elements for performance.
    for element in document.select(&BLOCK_LEVEL_ELEMENTS_SELECTOR) {
        // Check only if the element's *direct* text contains the pattern,
        // to avoid matching a parent div of the entire email.
        let direct_text = element
            .children()
            .filter_map(|c| c.value().as_text())
            .map(|t| t.text.as_ref())
            .collect::<String>();

        if GENERIC_SPLITTER_RE.is_match(direct_text.trim()) {
            return Some(element);
        }
    }
    None
}

/// Finds the first "On [date] [sender] wrote:" attribution anywhere in the body
/// and cuts at the text node where it starts. This catches attributions that
/// share an element with the reply, which element-level strategies cannot cut
/// without dropping the reply.
fn find_on_wrote_text_splitter(document: &Html) -> Option<Cut> {
    let body = document.select(&BODY_SELECTOR).next()?;

    let mut text = String::new();
    let mut spans: Vec<(usize, NodeId)> = Vec::new();
    for node in body.descendants() {
        let Some(node_text) = node.value().as_text() else {
            continue;
        };
        if is_inside_non_content(node) {
            continue;
        }
        // Separate nodes so words from adjacent blocks don't run together.
        text.push('\n');
        spans.push((text.len(), node.id()));
        text.push_str(node_text);
    }

    let start = ON_WROTE_RE.find(&text)?.start();
    let index = spans
        .partition_point(|(node_start, _)| *node_start <= start)
        .checked_sub(1)?;
    let (node_start, node) = *spans.get(index)?;
    let text_offset = start - node_start;
    Some(Cut {
        node,
        text_offset: (text_offset > 0).then_some(text_offset),
    })
}

fn is_inside_non_content(node: NodeRef<'_, Node>) -> bool {
    node.ancestors().any(|ancestor| {
        ancestor
            .value()
            .as_element()
            .is_some_and(|el| matches!(el.name(), "style" | "script" | "title" | "head"))
    })
}

/// The quoted thread starts at the horizontal rule when one sits directly
/// above the reply header. Empty wrappers around that rule count; real reply
/// text in between means the header itself is the cut.
fn outlook_reply_header_splitter(header: ElementRef<'_>) -> ElementRef<'_> {
    let mut sibling = header.prev_sibling();
    while let Some(node) = sibling {
        if let Some(element) = ElementRef::wrap(node) {
            if is_horizontal_rule(element) {
                return element;
            }
            if element.text().collect::<String>().trim().is_empty() {
                sibling = node.prev_sibling();
                continue;
            }
            return header;
        }
        if let Some(text) = node.value().as_text()
            && !text.trim().is_empty()
        {
            return header;
        }
        sibling = node.prev_sibling();
    }
    header
}

/// An `hr`, or an element that contains nothing else (Outlook centers the rule
/// in a div).
fn is_horizontal_rule(element: ElementRef<'_>) -> bool {
    if element.value().name().eq_ignore_ascii_case("hr") {
        return true;
    }
    let mut saw_rule = false;
    for child in element.children() {
        if let Some(child_element) = ElementRef::wrap(child) {
            if child_element.value().name().eq_ignore_ascii_case("br") {
                continue;
            }
            if !is_horizontal_rule(child_element) {
                return false;
            }
            saw_rule = true;
        } else if let Some(text) = child.value().as_text()
            && !text.trim().is_empty()
        {
            return false;
        }
    }
    saw_rule
}

// --- Low-Level Utilities ---

/// Finds the previous non-trivial sibling element of a given element, skipping
/// insignificant nodes like whitespace or empty elements.
fn find_prev_significant_sibling(el: ElementRef) -> Option<ElementRef> {
    let mut current_sibling = el.prev_sibling();

    while let Some(node) = current_sibling {
        if let Some(prev_el) = ElementRef::wrap(node) {
            // An element is significant if its text content is not just whitespace.
            if !prev_el.text().collect::<String>().trim().is_empty() {
                return Some(prev_el);
            }
        } else if let Some(text) = node.value().as_text() {
            // If we hit meaningful text before finding an element, stop.
            if !text.trim().is_empty() {
                return None;
            }
        }
        // The current node was insignificant; move to the next previous sibling.
        current_sibling = node.prev_sibling();
    }
    None
}

/// Traverses the DOM to collect all HTML content that appears before the cut.
fn get_html_before_cut(document: &Html, cut: Cut) -> String {
    let Some(splitter) = document.tree.get(cut.node) else {
        return String::new();
    };
    let body = std::iter::once(splitter)
        .chain(splitter.ancestors())
        .filter_map(ElementRef::wrap)
        .find(|el| el.value().name().eq_ignore_ascii_case("body"));

    let result = if let Some(body) = body {
        get_previous_html_recursively(body, cut)
    } else {
        String::new()
    };

    result.trim().to_string()
}

/// A recursive helper function that builds the HTML string by traversing the tree.
fn get_previous_html_recursively(current_element: ElementRef, cut: Cut) -> String {
    let mut reply_html_parts = Vec::new();

    for child in current_element.children() {
        // First, check if the child node IS the splitter itself.
        if child.id() == cut.node {
            // Keep the part of a text node before the attribution.
            if let (Some(offset), Some(text)) = (cut.text_offset, child.value().as_text())
                && let Some(before) = text.get(..offset)
            {
                reply_html_parts.push(escape_text(before));
            }
            break;
        }

        // If the child is not the splitter, check if it CONTAINS the splitter.
        let contains_splitter = child.descendants().any(|d| d.id() == cut.node);

        if contains_splitter {
            if let Some(child_el) = ElementRef::wrap(child) {
                reply_html_parts.push(get_previous_html_recursively(child_el, cut));
            }
            break;
        } else {
            let html_part = if let Some(element) = ElementRef::wrap(child) {
                element.html()
            } else if let Some(text) = child.value().as_text() {
                escape_text(text)
            } else if let Some(comment) = child.value().as_comment() {
                format!("<!--{}-->", comment.deref())
            } else {
                String::new()
            };
            reply_html_parts.push(html_part);
        }
    }

    reply_html_parts.join("")
}

/// Text nodes hold decoded text; re-escape it so `&lt;addr&gt;` doesn't turn
/// into markup.
fn escape_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\u{a0}', "&nbsp;")
}

/// Whether a reply has anything a reader would see: text or an image.
fn has_visible_content(html: &str) -> bool {
    let fragment = Html::parse_fragment(html);
    fragment.select(&IMG_SELECTOR).next().is_some()
        || fragment
            .root_element()
            .descendants()
            .filter(|node| !is_inside_non_content(*node))
            .filter_map(|node| node.value().as_text())
            .any(|text| !text.trim().is_empty())
}
