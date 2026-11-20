//! Exact provider-owned HTML boundaries, shared by ordinary edits and event replacement.
use super::*;
use email_utils::bounded_html;
use scraper::{ElementRef, Html};

/// Refuses a body whose parse stopped at a bound of [`bounded_html`]: what
/// it left out cannot be checked for the meeting link, and writing the rest
/// back would cut the description short.
const TOO_LARGE: &str = "This event's description is too large for Macro to edit safely. Edit or replace the event in Outlook to preserve your description.";

/// Split a recognized meeting block from user content. Never infer ownership from
/// aggregate text: an ordinary wrapper may also contain the user's trailing notes.
pub(super) fn split(content: &str, join: &str) -> Result<(String, String), CalendarProviderError> {
    let parsed = bounded_html::parse_fragment(content);
    if parsed.clipped {
        tracing::warn!(
            body_bytes = content.len(),
            "refused to split an Outlook event body too large to parse whole"
        );
        return Err(unsupported(TOO_LARGE));
    }
    let mut document = parsed.html;
    let blocks: Vec<_> = provider_blocks(&document)
        .into_iter()
        .map(|element| (element.id(), element.html()))
        .collect();
    let meeting = blocks
        .iter()
        .map(|(_, html)| html.as_str())
        .collect::<String>();
    if !html_escape::decode_html_entities(&meeting).contains(join) {
        return Err(unsupported(
            "This meeting's online details cannot be separated safely. Edit or replace the event in Outlook to preserve your description.",
        ));
    }
    for (id, _) in blocks {
        if let Some(mut node) = document.tree.get_mut(id) {
            node.detach();
        }
    }
    let description = document.root_element().inner_html();
    if html_escape::decode_html_entities(&description).contains(join) {
        return Err(unsupported(
            "This event also contains its old meeting link outside the provider block. Review the description in Outlook before replacing it.",
        ));
    }
    Ok((description, meeting))
}

fn provider_owned(element: &ElementRef<'_>) -> bool {
    element
        .value()
        .classes()
        .any(|class| class.starts_with("me-email"))
}

/// The outermost provider-owned `div`s, in document order. One walk that
/// skips everything inside a provider-owned element: checking each `div`'s
/// ancestors instead reads an ancestor's classes once per `div` inside it.
fn provider_blocks(document: &Html) -> Vec<ElementRef<'_>> {
    let mut blocks = Vec::new();
    let mut pending = vec![*document.root_element()];
    while let Some(node) = pending.pop() {
        if let Some(element) = ElementRef::wrap(node)
            && provider_owned(&element)
        {
            if element.value().name() == "div" {
                blocks.push(element);
            }
            continue;
        }
        pending.extend(node.children().rev());
    }
    blocks
}

#[cfg(test)]
mod test;
