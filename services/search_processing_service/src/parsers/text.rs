//! Searchable text of text-like files: code, HTML, plain text, and legacy
//! markdown. Uploaded files are not always UTF-8; a page saved by an older
//! editor is often Windows-1252, and decoding it fails the same way on every
//! attempt, so text that is not valid UTF-8 is decoded rather than rejected.

use encoding_rs::{Encoding, UTF_8, UTF_16BE, UTF_16LE};
use model::document::FileType;

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

    let (encoding, bom_length) = Encoding::for_bom(&bytes)
        .or_else(|| {
            is_html(file_type)
                .then(|| declared_html_charset(&bytes))
                .flatten()
                .map(|encoding| (encoding, 0))
        })
        .unwrap_or((UTF_8, 0));

    let (text, had_errors) = encoding.decode_without_bom_handling(&bytes[bom_length..]);
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
    const CHARSET: &[u8] = b"charset";

    let head = &bytes[..bytes.len().min(CHARSET_PRESCAN_BYTES)];
    let lowercase_head = head.to_ascii_lowercase();
    let mut search_from = 0;

    while let Some(position) = lowercase_head[search_from..]
        .windows(CHARSET.len())
        .position(|window| window == CHARSET)
    {
        search_from += position + CHARSET.len();

        let Some(value) = head[search_from..].trim_ascii_start().strip_prefix(b"=") else {
            continue;
        };
        let value = value.trim_ascii_start();
        let value = value
            .strip_prefix(b"\"")
            .or_else(|| value.strip_prefix(b"'"))
            .unwrap_or(value);
        let label_length = value
            .iter()
            .position(|byte| byte.is_ascii_whitespace() || b"\"';>/".contains(byte))
            .unwrap_or(value.len());

        let Some(encoding) = Encoding::for_label(&value[..label_length]) else {
            continue;
        };
        if encoding == UTF_16LE || encoding == UTF_16BE {
            return Some(UTF_8);
        }
        return Some(encoding);
    }

    None
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
