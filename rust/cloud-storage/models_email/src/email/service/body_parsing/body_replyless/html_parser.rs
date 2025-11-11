use super::constants::*;
use scraper::{Element, ElementRef, Html};
use std::{collections::HashSet, ops::Deref};
// --- Public API ---

/// Parses an email's HTML content and returns the cleaned, latest reply.
pub fn extract_reply_html(subject: Option<&str>, html_content: &str) -> String {
    let document = Html::parse_document(html_content);

    if subject.is_some() && subject.unwrap().starts_with("Fwd:") {
        // If it's a forward, the entire original HTML is the desired content.
        return html_content.to_string();
    }

    let splitter = find_splitter(&document);

    if let Some(splitter_element) = splitter {
        get_html_before_element(splitter_element)
    } else {
        // No splitter found, so assume the entire body is the reply.
        document
            .select(&BODY_SELECTOR)
            .next()
            .map(|body| body.inner_html())
            .unwrap_or_else(|| document.root_element().inner_html())
    }
}

// --- Core Logic & Orchestration ---

/// Orchestrates the search for a splitter element by finding all potential
/// candidates and choosing the one that appears earliest in the document.
fn find_splitter(document: &Html) -> Option<ElementRef<'_>> {
    // 1. Collect the NodeIds of all possible splitter candidates.
    let candidate_ids: HashSet<_> = vec![
        find_gmail_splitter(document),
        find_outlook_splitter(document),
        find_yahoo_splitter(document),
        find_blockquote_splitter(document),
        find_text_based_splitter(document),
    ]
    .into_iter()
    .flatten()
    // Map the ElementRefs to their NodeIds.
    .map(|el| el.id())
    .collect();

    // 2. If no candidates were found, there is no splitter.
    if candidate_ids.is_empty() {
        return None;
    }

    // 3. Perform a single depth-first traversal of the entire document.
    //    The `find_map` method will stop and return the very first time our closure returns `Some`.

    document.root_element().traverse().find_map(|edge| {
        // We only care about opening tags of nodes.
        if let ego_tree::iter::Edge::Open(node) = edge {
            // Check if this node's ID is in our set of candidates.
            if candidate_ids.contains(&node.id()) {
                // It is! This must be the earliest one.
                // Wrap it as an ElementRef and return it to stop the search.
                return ElementRef::wrap(node);
            }
        }
        // This node was not a candidate, continue the search.
        None
    })
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
        // Check if the node right before the blockquote is an "On... wrote:" line.
        if let Some(prev_el) = find_prev_significant_sibling(blockquote)
            && ON_WROTE_RE.is_match(&prev_el.text().collect::<String>())
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

/// Traverses the DOM to collect all HTML content that appears before the splitter element.
fn get_html_before_element(splitter: ElementRef) -> String {
    let mut body_opt = None;
    let mut current = Some(splitter);
    while let Some(el) = current {
        if el.value().name().eq_ignore_ascii_case("body") {
            body_opt = Some(el);
            break;
        }
        current = el.parent_element();
    }

    let result = if let Some(body) = body_opt {
        get_previous_html_recursively(body, splitter)
    } else {
        String::new()
    };

    result.trim().to_string()
}

/// A recursive helper function that builds the HTML string by traversing the tree.
fn get_previous_html_recursively(current_element: ElementRef, splitter: ElementRef) -> String {
    let mut reply_html_parts = Vec::new();

    for child in current_element.children() {
        // First, check if the child node IS the splitter itself.
        if child.id() == splitter.id() {
            // We have found the exact splitter element. Stop processing children at this level.
            // Do not add anything to the parts and break the loop.
            break;
        }

        // If the child is not the splitter, check if it CONTAINS the splitter.
        let contains_splitter = child.descendants().any(|d| d.id() == splitter.id());

        if contains_splitter {
            if let Some(child_el) = ElementRef::wrap(child) {
                reply_html_parts.push(get_previous_html_recursively(child_el, splitter));
            }
            break;
        } else {
            let html_part = if let Some(element) = ElementRef::wrap(child) {
                element.html()
            } else if let Some(text) = child.value().as_text() {
                text.to_string()
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
