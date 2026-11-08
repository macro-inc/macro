//! Searchable text of text-like files: code, HTML, plain text, and legacy
//! markdown. Uploaded files are not always UTF-8; a page saved by an older
//! editor is often Windows-1252, and decoding it fails the same way on every
//! attempt, so text that is not valid UTF-8 is decoded rather than rejected.

use encoding_rs::{Encoding, UTF_8, UTF_16BE, UTF_16LE};
use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_till1, take_until},
    character::complete::{multispace0, one_of},
    combinator::{opt, value},
    sequence::preceded,
};
use shared_types::document::FileType;

/// How far into an HTML file a `charset` declaration is looked for, as in the
/// HTML standard's encoding prescan.
const CHARSET_PRESCAN_BYTES: usize = 1024;

/// A decoded file with more than one replacement character in this many
/// characters is binary or in an unrecognized encoding, so its text would
/// only add noise to search.
const MAX_CHARS_PER_REPLACEMENT: usize = 10;

/// Decodes a text-like file for indexing, or returns `None` when it is not
/// readable as text. Valid UTF-8 is returned unchanged. Otherwise a byte
/// order mark, then an HTML file's declared `charset`, picks the encoding;
/// anything else is read as UTF-8 with malformed bytes replaced.
pub fn decode_text(bytes: Vec<u8>, file_type: FileType) -> Option<String> {
    let bytes = match String::from_utf8(bytes) {
        Ok(text) => return Some(text),
        Err(error) => error.into_bytes(),
    };

    let encoding = Encoding::for_bom(&bytes)
        .map(|(encoding, _)| encoding)
        .or_else(|| {
            is_html(file_type)
                .then(|| declared_html_charset(&bytes))
                .flatten()
        })
        .unwrap_or(UTF_8);

    let (text, had_errors) = encoding.decode_with_bom_removal(&bytes);
    if had_errors && is_mostly_replacements(&text) {
        return None;
    }

    tracing::debug!(
        encoding = encoding.name(),
        had_errors,
        "decoded text that is not valid UTF-8"
    );
    Some(text.into_owned())
}

fn is_html(file_type: FileType) -> bool {
    matches!(
        file_type,
        FileType::Html | FileType::Htm | FileType::Shtml | FileType::Xhtml | FileType::Xht
    )
}

/// The encoding named by the first recognized `charset=` in the head of an
/// HTML file, as written by `<meta charset>` or a `Content-Type` meta tag. A
/// declared UTF-16 means UTF-8, since UTF-16 text would have a byte order mark.
fn declared_html_charset(bytes: &[u8]) -> Option<&'static Encoding> {
    let head = bytes
        .get(..CHARSET_PRESCAN_BYTES)
        .unwrap_or(bytes)
        .to_ascii_lowercase();
    let mut input = head.as_slice();

    while let Ok((after_charset, ())) = past_next_charset(input) {
        input = after_charset;

        let Ok((_, label)) = charset_label(after_charset) else {
            continue;
        };
        let Some(encoding) = Encoding::for_label(label) else {
            continue;
        };
        if encoding == UTF_16LE || encoding == UTF_16BE {
            return Some(UTF_8);
        }
        return Some(encoding);
    }

    None
}

/// Skips past the next `charset` in lowercased input.
fn past_next_charset(input: &[u8]) -> IResult<&[u8], ()> {
    value((), (take_until(&b"charset"[..]), tag(&b"charset"[..]))).parse(input)
}

/// The label in `= "windows-1252"`, as it follows a `charset` name.
fn charset_label(input: &[u8]) -> IResult<&[u8], &[u8]> {
    preceded(
        (
            multispace0,
            tag(&b"="[..]),
            multispace0,
            opt(one_of(&b"\"'"[..])),
        ),
        take_till1(|byte: u8| byte.is_ascii_whitespace() || b"\"';>/".contains(&byte)),
    )
    .parse(input)
}

fn is_mostly_replacements(text: &str) -> bool {
    let mut chars = 0;
    let mut replacements = 0;
    for char in text.chars() {
        chars += 1;
        if char == char::REPLACEMENT_CHARACTER {
            replacements += 1;
        }
    }
    replacements * MAX_CHARS_PER_REPLACEMENT > chars
}

#[cfg(test)]
mod test;
