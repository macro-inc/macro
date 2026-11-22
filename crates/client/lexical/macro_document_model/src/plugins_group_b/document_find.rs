//! Source document Find: immutable UTF-16 match pieces over the committed tree.
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, item::get_checked};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[cfg(test)]
mod replace_test;
#[cfg(test)]
mod test;

const FIND: &str = "group-b.document-find";
const STATS: &str = "group-b.document-stats";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    search: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
    if name != FIND && name != STATS {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("application query generation"));
    }
    if name == STATS {
        return stats(state.view()).map(Some);
    }
    if !data.is_object() {
        return Err(Error::Invariant("document find request must be an object"));
    }
    let request: Request = serde_json::from_value(data.clone())?;
    Ok(Some(
        json!({"pieces": find(state.view(), &request.search)?}),
    ))
}

// findAndReplacePlugin.ts DO_REPLACE_COMMAND / DO_REPLACE_ONCE_COMMAND over the
// pieces the find bar holds: one ordinary (undoable) update.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplaceRequest {
    replace_string: String,
    once: bool,
    pieces: Vec<Piece>,
}

#[derive(Clone, Debug)]
struct Replace {
    replace_string: Vec<u16>,
    once: bool,
    pieces: Vec<(NodeKey, Piece)>,
}

static REPLACE: CommandKey<Replace> = CommandKey::new("group-b.document-replace");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&REPLACE),
    priority: CommandPriority::High,
    placement: Placement::After,
}];

/// JS String.prototype.substring: clamp, then order the bounds.
fn substring(text: &[u16], start: i64, end: i64) -> &[u16] {
    let len = i64::try_from(text.len()).unwrap_or(i64::MAX);
    let clamp = |value: i64| usize::try_from(value.clamp(0, len)).unwrap_or(text.len());
    let (start, end) = (clamp(start), clamp(end));
    &text[start.min(end)..start.max(end)]
}

fn units(len: usize) -> i64 {
    i64::try_from(len).unwrap_or(i64::MAX)
}

fn handle_replace(tx: &mut Transaction<'_>, command: &Replace) -> Result<(), Error> {
    // pairKeysWithNonTextNodes: a match touching any non-text leaf is skipped whole.
    let skip: std::collections::HashSet<u32> = command
        .pieces
        .iter()
        .filter(|(key, _)| tx.view().text(*key).is_none())
        .map(|(_, piece)| piece.pair_key)
        .collect();
    let mut previous = None;
    let mut length_diff: i64 = 0;
    let mut replaced = 0;
    let mut next_key = None;
    let mut rewritten = std::collections::HashSet::new();
    for (key, piece) in &command.pieces {
        if skip.contains(&piece.pair_key) {
            continue;
        }
        let (start, end) = if previous == Some(*key) {
            (
                i64::from(piece.start) - length_diff,
                i64::from(piece.end) - length_diff,
            )
        } else {
            length_diff = 0;
            (i64::from(piece.start), i64::from(piece.end))
        };
        if tx.view().kind(*key).is_some() {
            let text: Vec<u16> = tx.view().text_content(*key).encode_utf16().collect();
            let mut next: Vec<u16> = substring(&text, 0, start).to_vec();
            if piece.is_replace {
                // Source replace-once skips later matches without advancing its cursor.
                if command.once && replaced > 0 {
                    next_key = Some(*key);
                    continue;
                }
                next.extend_from_slice(&command.replace_string);
                replaced += 1;
            }
            next.extend_from_slice(substring(&text, end, units(text.len())));
            if tx.view().text(*key).is_some() {
                if next.is_empty() {
                    tx.remove(*key, false)?;
                } else {
                    tx.text(*key)?
                        .set_text_content(&String::from_utf16_lossy(&next))?;
                    rewritten.insert(*key);
                }
            }
            length_diff += units(text.len()) - units(next.len());
        }
        previous = Some(*key);
    }
    clamp_rewritten_points(tx, &rewritten)?;
    if let Some(key) = next_key {
        let mut nodes = NodeSelection::new();
        nodes.add(key);
        tx.set_selection(Some(Selection::Node(nodes)))?;
    }
    Ok(())
}

// Source setTextContent leaves the selection alone, so an in-range offset keeps
// its number; a point past a rewritten node's new end would be an invalid model
// selection here, so only that point is clamped to the end.
fn clamp_rewritten_points(
    tx: &mut Transaction<'_>,
    rewritten: &std::collections::HashSet<NodeKey>,
) -> Result<(), Error> {
    let Some(Selection::Range(range)) = tx.selection() else {
        return Ok(());
    };
    let clamp = |point: Point| match point {
        Point::Text { key, offset }
            if rewritten.contains(&key) && tx.view().text(key).is_some() =>
        {
            Point::text(key, offset.min(tx.view().text_content_size(key)))
        }
        other => other,
    };
    let (anchor, focus) = (clamp(range.anchor), clamp(range.focus));
    if anchor == range.anchor && focus == range.focus {
        return Ok(());
    }
    let mut next = range.clone();
    next.anchor = anchor;
    next.focus = focus;
    tx.set_selection(Some(Selection::Range(next)))
}

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != REPLACE.name() {
        return Ok(None);
    }
    let request: Value = serde_json::from_str(json)?;
    if !request.is_object() {
        return Err(Error::Invariant(
            "document replace request must be an object",
        ));
    }
    let request: ReplaceRequest = serde_json::from_value(request)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &REPLACE,
        Replace {
            replace_string: request.replace_string.encode_utf16().collect(),
            once: request.once,
            pieces: request
                .pieces
                .into_iter()
                .map(|piece| {
                    (
                        NodeKey::from_parts(KeyParts {
                            index: piece.key,
                            generation,
                        }),
                        piece,
                    )
                })
                .collect(),
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(DocumentReplace)
}

struct DocumentReplace;
impl Plugin for DocumentReplace {
    fn name(&self) -> &'static str {
        "group-b.document-replace"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(replace) = command.payload(&REPLACE) else {
            return Ok(Handled::No);
        };
        handle_replace(tx, replace)?;
        Ok(Handled::Yes)
    }
}

// wordcountPlugin text (root children joined by newlines) and selection text,
// and progressPlugin's leaf checklist counts.
fn stats(view: StateRef<'_>) -> Result<Value, Error> {
    let all = view
        .children(NodeKey::ROOT)
        .map(|child| view.text_content(child).into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    let selected = view.selection_text_content()?;
    let (mut completed, mut total) = (0u32, 0u32);
    for (key, _) in view.descendants(NodeKey::ROOT) {
        let Some(item) = view.cast::<ListItemNode>(key) else {
            continue;
        };
        let Some(checked) = get_checked(&view, item) else {
            continue;
        };
        if view.children(key).any(|child| view.is::<ListNode>(child))
            || js_trim(&view.text_content(key)).is_empty()
        {
            continue;
        }
        total += 1;
        if checked {
            completed += 1;
        }
    }
    Ok(json!({
        "text": all,
        "selected": (!selected.is_empty()).then_some(selected),
        "progress": {"completed": completed, "total": total},
    }))
}
