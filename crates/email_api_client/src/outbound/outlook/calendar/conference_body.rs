//! Exact provider-owned HTML boundaries, shared by ordinary edits and event replacement.
use super::*;
use email_utils::bounded_html;
use scraper::{
    ElementRef, Html,
    node::{Node, Text},
};
use std::collections::{HashMap, HashSet};

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
/// block in `saved`, the body Outlook holds now; an empty part belongs to it
/// only between two such elements, and a part showing only media only when
/// the block shows those same sources. The person's text
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
    replace_rewritten_block(parsed.html, saved, join, "")
}

/// `edited` with Outlook's own meeting block from `saved` where Macro's editor
/// left its rewritten copy, found as [`without_meeting`] finds it; a block
/// still carrying its markers is kept as it is. Refused when the block cannot
/// be separated or a body is too large to parse whole.
pub(super) fn with_saved_meeting(
    edited: &str,
    saved: &str,
    join: &str,
) -> Result<String, CalendarProviderError> {
    let parsed = bounded_html::parse_fragment(edited);
    if parsed.clipped {
        tracing::warn!(
            body_bytes = edited.len(),
            "refused to split an Outlook event body too large to parse whole"
        );
        return Err(CalendarProviderError::refused(TOO_LARGE));
    }
    if !provider_blocks(&parsed.html).is_empty() {
        return Ok(edited.to_owned());
    }
    let (_, meeting) = split(saved, join)?;
    replace_rewritten_block(parsed.html, saved, join, &meeting)
}

/// Stands in for the removed run until `replacement` takes its place.
const RUN_MARKER: &str = "\u{E000}macro-meeting-block\u{E000}";

/// Replace the top-level run of `document` that is Macro's rewrite of the
/// meeting block in `saved` with `replacement`, at the run's position.
fn replace_rewritten_block(
    document: Html,
    saved: &str,
    join: &str,
    replacement: &str,
) -> Result<String, CalendarProviderError> {
    let mut document = document;
    let (_, meeting) = split(saved, join)?;
    let meeting = bounded_html::parse_fragment(&meeting).html;
    // Each text of the block, with the most media an element holding it has,
    // so a part that adds an image to the block's text is not the block's.
    let mut meeting_texts: HashMap<String, usize> = HashMap::new();
    for element in meeting
        .root_element()
        .descendants()
        .filter_map(ElementRef::wrap)
    {
        let text = plain_text(&element);
        if text.is_empty() {
            continue;
        }
        let media = media_count(&element);
        meeting_texts
            .entry(text)
            .and_modify(|most| *most = (*most).max(media))
            .or_insert(media);
    }
    // Media in a part is the block's only when the block shows that same
    // source; media the person added, or media without a source to compare,
    // stays theirs.
    let meeting_sources: HashSet<String> =
        media_sources(&meeting.root_element()).flatten().collect();
    let part_of = |part: &ElementRef<'_>| {
        let text = plain_text(part);
        let media = media_count(part);
        let own_media = || {
            media_sources(part)
                .all(|source| source.is_some_and(|source| meeting_sources.contains(&source)))
        };
        match meeting_texts.get(&text) {
            _ if text.is_empty() && media == 0 => MeetingPart::Textless,
            _ if text.is_empty() && own_media() => MeetingPart::Meeting,
            _ if text.is_empty() => MeetingPart::Person,
            Some(&most) if media <= most && own_media() => MeetingPart::Meeting,
            Some(_) => MeetingPart::Mixed,
            None => MeetingPart::Person,
        }
    };

    if document.root_element().inner_html().contains(RUN_MARKER) {
        return Err(not_separable());
    }
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
            MeetingPart::Person | MeetingPart::Mixed => break,
        }
    }
    let mut last = link;
    for (index, part) in parts.iter().enumerate().skip(link + 1) {
        match part_of(part) {
            MeetingPart::Meeting => last = index,
            MeetingPart::Textless => {}
            MeetingPart::Person | MeetingPart::Mixed => break,
        }
    }
    let left_over = parts
        .iter()
        .enumerate()
        .any(|(index, part)| match part_of(part) {
            MeetingPart::Mixed => true,
            MeetingPart::Meeting => !(first..=last).contains(&index),
            MeetingPart::Person | MeetingPart::Textless => false,
        });
    if left_over {
        return Err(not_separable());
    }
    let removed: Vec<_> = parts[first..=last].iter().map(|part| part.id()).collect();
    if let Some(mut node) = document.tree.get_mut(removed[0]) {
        node.insert_before(Node::Text(Text {
            text: RUN_MARKER.into(),
        }));
    }
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
    Ok(description.replacen(RUN_MARKER, replacement, 1))
}

/// Whose a top-level part of an edited description is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MeetingPart {
    Meeting,
    Person,
    Textless,
    /// The block's text with media the block does not have.
    Mixed,
}

/// Elements that show something besides text.
const MEDIA_ELEMENTS: [&str; 9] = [
    "img", "picture", "video", "audio", "iframe", "object", "embed", "svg", "canvas",
];

/// Where each media element under `element` loads from, or `None` for one
/// whose source cannot be told apart from another's.
fn media_sources<'a>(element: &ElementRef<'a>) -> impl Iterator<Item = Option<String>> + 'a {
    element
        .descendants()
        .filter_map(ElementRef::wrap)
        .filter(|descendant| MEDIA_ELEMENTS.contains(&descendant.value().name()))
        .map(|media| {
            ["src", "data", "srcset"]
                .iter()
                .filter_map(|attribute| media.value().attr(attribute))
                .map(str::trim)
                .find(|source| !source.is_empty())
                .map(str::to_owned)
        })
}

fn media_count(element: &ElementRef<'_>) -> usize {
    element
        .descendants()
        .filter_map(ElementRef::wrap)
        .filter(|descendant| MEDIA_ELEMENTS.contains(&descendant.value().name()))
        .count()
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
