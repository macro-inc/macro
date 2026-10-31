//! `<m-attachment>` markers: how an agent asks for a file to be attached to
//! the reply it is writing.

use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_until, take_while1},
    sequence::delimited,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const OPEN: &str = "<m-attachment>";
const CLOSE: &str = "</m-attachment>";

#[cfg(test)]
mod test;

/// How an attached static file renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentKind {
    /// An inline image.
    Image,
    /// An inline, playable video.
    Video,
}

/// One file the agent asked to attach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMarker {
    /// The static file to attach.
    pub static_file_id: Uuid,
    /// How it renders.
    pub kind: AttachmentKind,
    /// Intrinsic pixel width, so the message reserves its space.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Intrinsic pixel height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

impl AttachmentMarker {
    /// The marker as the agent writes it.
    pub fn render(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        format!("{OPEN}{json}{CLOSE}")
    }
}

/// Remove every marker outside code from `markdown`, returning the text left
/// and the markers that named a file.
///
/// A marker whose body does not name a file is removed without a marker, so
/// the reader never sees its JSON. Markers inside fenced code blocks or
/// inline code are text the agent is showing, and stay as written. A line
/// left empty by its markers is dropped with the blank line it leaves behind.
pub fn take_attachment_markers(markdown: &str) -> (String, Vec<AttachmentMarker>) {
    let mut markers = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut dropped = false;
    for line in markdown.split('\n') {
        if let Some(open) = fence {
            if closes_fence(line, open) {
                fence = None;
            }
            lines.push(line.to_owned());
            dropped = false;
            continue;
        }
        if let Some(open) = opens_fence(line) {
            fence = Some(open);
            lines.push(line.to_owned());
            dropped = false;
            continue;
        }
        if !line.contains(OPEN) {
            // The blank line a dropped marker line left would double the gap,
            // or open the reply with a gap.
            let doubled = dropped
                && line.trim().is_empty()
                && lines.last().is_none_or(|last| last.trim().is_empty());
            if !doubled {
                lines.push(line.to_owned());
            }
            // Blank lines after a dropped marker line still trail it.
            dropped = dropped && line.trim().is_empty();
            continue;
        }
        let (kept, taken) = take_from_line(line);
        let Some(taken) = taken else {
            lines.push(kept);
            dropped = false;
            continue;
        };
        markers.extend(taken);
        if kept.trim().is_empty() {
            dropped = true;
            continue;
        }
        lines.push(kept.trim_end().to_owned());
        dropped = false;
    }
    // A reply that ended with its markers ends with what came before them.
    if dropped {
        while lines.last().is_some_and(|last| last.trim().is_empty()) {
            lines.pop();
        }
    }
    (lines.join("\n"), markers)
}

/// A fenced code block's opening line: up to three spaces, then three or
/// more backticks or tildes.
fn opens_fence(line: &str) -> Option<(char, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let fence_char = rest.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let run = rest.chars().take_while(|c| *c == fence_char).count();
    (run >= 3).then_some((fence_char, run))
}

fn closes_fence(line: &str, (fence_char, run): (char, usize)) -> bool {
    let trimmed = line.trim();
    trimmed.chars().take_while(|c| *c == fence_char).count() >= run
        && trimmed.chars().all(|c| c == fence_char)
}

/// One piece of a line outside fenced code.
enum Piece<'a> {
    /// Inline code, kept as written.
    Code(&'a str),
    /// A marker's body.
    Marker(&'a str),
    /// Anything else.
    Text(&'a str),
}

fn marker(input: &str) -> IResult<&str, Piece<'_>> {
    delimited(tag(OPEN), take_until(CLOSE), tag(CLOSE))
        .map(Piece::Marker)
        .parse(input)
}

/// A backtick run and everything up to the same run again; an unmatched run
/// is plain text.
fn code_span(input: &str) -> IResult<&str, Piece<'_>> {
    let (rest, ticks) = take_while1(|c| c == '`')(input)?;
    let end = rest
        .match_indices(ticks)
        .find(|(at, _)| !rest[at + ticks.len()..].starts_with('`'))
        .map(|(at, _)| at + ticks.len());
    match end {
        Some(end) => {
            let consumed = ticks.len() + end;
            Ok((&input[consumed..], Piece::Code(&input[..consumed])))
        }
        None => Ok((rest, Piece::Text(ticks))),
    }
}

fn text(input: &str) -> IResult<&str, Piece<'_>> {
    take_while1(|c| c != '`' && c != '<')
        .map(Piece::Text)
        .parse(input)
}

fn piece(input: &str) -> IResult<&str, Piece<'_>> {
    if let Ok(found) = nom::branch::alt((marker, code_span, text)).parse(input) {
        return Ok(found);
    }
    let width = input.chars().next().map_or(0, char::len_utf8);
    Ok((&input[width..], Piece::Text(&input[..width])))
}

fn pieces(line: &str) -> Vec<Piece<'_>> {
    let mut rest = line;
    let mut out = Vec::new();
    while !rest.is_empty() {
        let Ok((next, found)) = piece(rest) else {
            break;
        };
        out.push(found);
        rest = next;
    }
    out
}

/// The line with its markers removed, and the markers that named a file;
/// `None` when the line had no marker outside code.
fn take_from_line(line: &str) -> (String, Option<Vec<AttachmentMarker>>) {
    let mut kept = String::with_capacity(line.len());
    let mut taken = None;
    let mut after_marker = false;
    for found in pieces(line) {
        match found {
            Piece::Marker(body) => {
                let markers: &mut Vec<AttachmentMarker> = taken.get_or_insert_default();
                markers.extend(serde_json::from_str(body.trim()).ok());
                after_marker = true;
            }
            Piece::Code(code) => {
                kept.push_str(code);
                after_marker = false;
            }
            Piece::Text(text) => {
                // Removing a marker between two words leaves one space.
                let text = if after_marker && kept.ends_with(' ') {
                    text.trim_start_matches(' ')
                } else {
                    text
                };
                kept.push_str(text);
                after_marker = false;
            }
        }
    }
    (kept, taken)
}
