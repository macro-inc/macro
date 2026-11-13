//! Source document Find: immutable UTF-16 match pieces over the committed tree.
use lexical_model::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[cfg(test)]
mod test;

const FIND: &str = "group-b.document-find";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    search: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Piece {
    key: u32,
    start: u32,
    end: u32,
    is_replace: bool,
    pair_key: u32,
}

struct Segment {
    key: NodeKey,
    start: usize,
    end: usize,
}

// findAndReplacePlugin.ts:84-115, collectTextSegments. Blocks contribute
// ownerless newlines; linebreak, tab and decorator leaves keep their own text.
fn collect(
    view: StateRef<'_>,
    key: NodeKey,
    text: &mut Vec<u16>,
    segments: &mut Vec<Segment>,
) -> Result<(), Error> {
    let ty = view.type_name(key)?;
    if matches!(ty, "horizontalrule" | "equation") {
        return Ok(());
    }
    if view.kind(key) == Some(NodeKind::Element) {
        let block = !view.is_inline(key);
        if block && !text.is_empty() && text.last() != Some(&u16::from(b'\n')) {
            text.push(u16::from(b'\n'));
        }
        for child in view.children(key) {
            collect(view, child, text, segments)?;
        }
        if block {
            text.push(u16::from(b'\n'));
        }
        return Ok(());
    }
    let start = text.len();
    text.extend(view.text_content(key).encode_utf16());
    if text.len() > start {
        segments.push(Segment {
            key,
            start,
            end: text.len(),
        });
    }
    if matches!(ty, "image" | "inline-image" | "excalidraw") {
        text.push(u16::from(b'\n'));
    }
    Ok(())
}

fn offset(value: usize) -> Result<u32, Error> {
    u32::try_from(value).map_err(|_| Error::Invariant("document find offset overflow"))
}

// regress parses adjacent escaped surrogate units as one code point even in
// legacy mode. Singleton classes keep each unit separate for UCS-2 matching.
fn literal_pattern(units: impl Iterator<Item = u16>) -> String {
    units
        .map(|unit| {
            if (0xd800..=0xdfff).contains(&unit) {
                format!("[\\u{unit:04x}]")
            } else {
                format!("\\u{unit:04x}")
            }
        })
        .collect()
}

// findAndReplacePlugin.ts:123-162, findMatchOffsets. Unit escapes represent
// exactly the Source escaped literal, without interpreting query metacharacters.
// The existing regress legacy table supplies non-Unicode /i Canonicalize;
// UCS-2 deliberately retains surrogate code units rather than decoding pairs.
fn find(view: StateRef<'_>, search: &str) -> Result<Vec<Piece>, Error> {
    let mut text = Vec::new();
    let mut segments = Vec::new();
    collect(view, NodeKey::ROOT, &mut text, &mut segments)?;
    let pattern = literal_pattern(search.encode_utf16());
    let regex = regress::Regex::with_flags(&pattern, "i")
        .map_err(|error| Error::InvariantMessage(format!("document find pattern: {error}")))?;
    let mut pieces = Vec::new();
    let mut segment_index = 0;
    for (index, matched) in regex.find_from_ucs2(&text, 0).enumerate() {
        let start = matched.start();
        let end = matched.end();
        if start == end {
            break;
        }
        let pair_key = offset(index)?
            .checked_add(1)
            .ok_or(Error::Invariant("document find match count overflow"))?;
        while segment_index < segments.len() && segments[segment_index].end <= start {
            segment_index += 1;
        }
        let mut is_replace = true;
        for segment in segments[segment_index..]
            .iter()
            .take_while(|segment| segment.start < end)
        {
            pieces.push(Piece {
                key: segment.key.parts().index,
                start: offset(start.max(segment.start) - segment.start)?,
                end: offset(end.min(segment.end) - segment.start)?,
                is_replace,
                pair_key,
            });
            is_replace = false;
        }
    }
    Ok(pieces)
}

pub(super) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name != FIND {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("application query generation"));
    }
    if !data.is_object() {
        return Err(Error::Invariant("document find request must be an object"));
    }
    let request: Request = serde_json::from_value(data.clone())?;
    Ok(Some(
        json!({"pieces": find(state.view(), &request.search)?}),
    ))
}
