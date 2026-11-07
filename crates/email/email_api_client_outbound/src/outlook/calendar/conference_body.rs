//! Exact provider-owned HTML boundaries, shared by ordinary edits and event replacement.
use super::*;
use scraper::{ElementRef, Html, Selector};

/// Split a recognized meeting block from user content. Never infer ownership from
/// aggregate text: an ordinary wrapper may also contain the user's trailing notes.
pub(super) fn split(content: &str, join: &str) -> Result<(String, String), CalendarProviderError> {
    let mut document = Html::parse_fragment(content);
    let selector = Selector::parse("div").map_err(|_| invalid())?;
    let provider_owned = |element: &ElementRef<'_>| {
        element
            .value()
            .classes()
            .any(|class| class.starts_with("me-email"))
    };
    let blocks: Vec<_> = document
        .select(&selector)
        .filter(provider_owned)
        .filter(|element| {
            !element
                .ancestors()
                .filter_map(ElementRef::wrap)
                .any(|ancestor| provider_owned(&ancestor))
        })
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
