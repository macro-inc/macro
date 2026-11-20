//! Exact provider-owned HTML boundaries, shared by ordinary edits and event replacement.
use super::*;
use email_utils::bounded_html;
use scraper::{ElementRef, Html};
use std::collections::HashSet;

/// Refuses a body whose parse stopped at a bound of [`bounded_html`]: what
/// it left out cannot be checked for the meeting link, and writing the rest
/// back would cut the description short.
const TOO_LARGE: &str =
    "This event's description is too large to edit in Macro. Edit the event in Outlook instead.";

/// Split a recognized meeting block from user content. Never infer ownership from
/// aggregate text: an ordinary wrapper may also contain the user's trailing notes.
pub(super) fn split(content: &str, join: &str) -> Result<(String, String), CalendarProviderError> {
    let parsed = bounded_html::parse_fragment(content);
    if parsed.clipped {
        tracing::warn!(
            body_bytes = content.len(),
            "refused to split an Outlook event body too large to parse whole"
        );
        return Err(CalendarProviderError::refused(TOO_LARGE));
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
        return Err(not_separable());
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

/// The person's text of a description edited in Macro, without the old
/// meeting's block. The editor keeps the block's text but drops the
/// `me-email*` markers [`split`] finds it by, laying each of its parts out as
/// a top-level paragraph. So the block is the run of top-level elements
/// around the join link whose text each is the text of an element of the
/// block in `saved`, the body Outlook holds now; textless parts (an image, a
/// rule) belong to it only between two such elements. The person's text
/// around it stays, and a description with the link, or a part of the block,
/// anywhere else is refused.
pub(super) fn without_meeting(
    edited: &str,
    saved: &str,
    join: &str,
) -> Result<String, CalendarProviderError> {
    if !html_escape::decode_html_entities(edited).contains(join) {
        return Ok(edited.to_owned());
    }
    let parsed = bounded_html::parse_fragment(edited);
    if parsed.clipped {
        tracing::warn!(
            body_bytes = edited.len(),
            "refused to split an Outlook event body too large to parse whole"
        );
        return Err(CalendarProviderError::refused(TOO_LARGE));
    }
    if !provider_blocks(&parsed.html).is_empty() {
        return split(edited, join).map(|(description, _)| description);
    }
    let (_, meeting) = split(saved, join)?;
    let meeting = bounded_html::parse_fragment(&meeting).html;
    let meeting_texts: HashSet<String> = meeting
        .root_element()
        .descendants()
        .filter_map(ElementRef::wrap)
        .map(|element| plain_text(&element))
        .filter(|text| !text.is_empty())
        .collect();
    let part_of = |part: &ElementRef<'_>| {
        let text = plain_text(part);
        if text.is_empty() {
            MeetingPart::Textless
        } else if meeting_texts.contains(&text) {
            MeetingPart::Meeting
        } else {
            MeetingPart::Person
        }
    };

    let mut document = parsed.html;
    let parts: Vec<_> = document
        .root_element()
        .children()
        .filter_map(ElementRef::wrap)
        .collect();
    let link = parts
        .iter()
        .position(|part| links_to(part, join))
        .filter(|&link| part_of(&parts[link]) == MeetingPart::Meeting)
        .ok_or_else(not_separable)?;
    let mut first = link;
    for index in (0..link).rev() {
        match part_of(&parts[index]) {
            MeetingPart::Meeting => first = index,
            MeetingPart::Textless => {}
            MeetingPart::Person => break,
        }
    }
    let mut last = link;
    for (index, part) in parts.iter().enumerate().skip(link + 1) {
        match part_of(part) {
            MeetingPart::Meeting => last = index,
            MeetingPart::Textless => {}
            MeetingPart::Person => break,
        }
    }
    let left_over = parts.iter().enumerate().any(|(index, part)| {
        !(first..=last).contains(&index) && part_of(part) == MeetingPart::Meeting
    });
    if left_over {
        return Err(not_separable());
    }
    let removed: Vec<_> = parts[first..=last].iter().map(|part| part.id()).collect();
    for id in removed {
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
    Ok(description)
}

/// Whose a top-level part of an edited description is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MeetingPart {
    Meeting,
    Person,
    Textless,
}

fn not_separable() -> CalendarProviderError {
    unsupported(
        "This meeting's online details cannot be separated safely. Edit or replace the event in Outlook to preserve your description.",
    )
}

/// An element's text without whitespace. Graph's bodies put line breaks
/// between tags that a rewrite of the markup drops, so only the other
/// characters compare.
fn plain_text(element: &ElementRef<'_>) -> String {
    element
        .text()
        .flat_map(str::chars)
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn links_to(element: &ElementRef<'_>, join: &str) -> bool {
    element
        .descendants()
        .filter_map(ElementRef::wrap)
        .any(|link| link.value().name() == "a" && link.value().attr("href") == Some(join))
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
