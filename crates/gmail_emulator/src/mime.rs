//! RFC 822 messages: building one from a [`NewMessage`], and parsing one into
//! the part tree Gmail returns as a message's `payload`.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use mail_builder::MessageBuilder;
use mail_builder::headers::address::Address;
use mailparse::{DispositionType, MailAddr, ParsedMail};
use serde_json::{Value, json};

use crate::EmulatorError;
use crate::seed::NewMessage;

const SNIPPET_CHARS: usize = 200;

/// One MIME part of a stored message.
#[derive(Clone, Debug)]
pub(crate) struct Part {
    pub(crate) part_id: String,
    pub(crate) mime_type: String,
    pub(crate) filename: String,
    pub(crate) headers: Vec<(String, String)>,
    /// The decoded body. Empty for a multipart container and for a part
    /// that wraps another message.
    pub(crate) body: Vec<u8>,
    /// Gmail returns an attachment's body by id, not inline.
    pub(crate) is_attachment: bool,
    pub(crate) parts: Vec<Part>,
}

/// What the emulator keeps about a message besides its bytes.
#[derive(Clone, Debug)]
pub(crate) struct Parsed {
    pub(crate) payload: Part,
    pub(crate) snippet: String,
    /// The `Message-ID` without angle brackets.
    pub(crate) message_id: Option<String>,
    /// The `Message-ID`s named by `In-Reply-To` and `References`.
    pub(crate) replies_to: Vec<String>,
    /// Lowercased text the `q` search matches bare words against.
    pub(crate) search_text: String,
    pub(crate) has_attachment: bool,
}

impl Parsed {
    pub(crate) fn header(&self, name: &str) -> Option<&str> {
        header(&self.payload.headers, name)
    }

    /// Every address in `To`, `Cc` and `Bcc`, lowercased.
    pub(crate) fn recipients(&self) -> Vec<String> {
        ["To", "Cc", "Bcc"]
            .iter()
            .filter_map(|name| self.header(name))
            .flat_map(addresses)
            .collect()
    }
}

pub(crate) fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

/// The addresses in an address header value, lowercased.
pub(crate) fn addresses(value: &str) -> Vec<String> {
    let Ok(list) = mailparse::addrparse(value) else {
        return Vec::new();
    };

    list.iter()
        .flat_map(|address| match address {
            MailAddr::Single(single) => vec![single.addr.to_lowercase()],
            MailAddr::Group(group) => group
                .addrs
                .iter()
                .map(|single| single.addr.to_lowercase())
                .collect(),
        })
        .collect()
}

fn builder_addresses(value: &str) -> Result<Address<'static>, EmulatorError> {
    let list = mailparse::addrparse(value)
        .map_err(|error| EmulatorError::InvalidMessage(format!("address `{value}`: {error}")))?;
    let singles = list.iter().flat_map(|address| match address {
        MailAddr::Single(single) => vec![single.clone()],
        MailAddr::Group(group) => group.addrs.clone(),
    });

    Ok(Address::new_list(
        singles
            .map(|single| Address::new_address(single.display_name, single.addr))
            .collect(),
    ))
}

/// Builds the RFC 822 bytes of a message described by its parts.
pub(crate) fn build_raw(
    message: &NewMessage,
    mailbox: &str,
    default_message_id: &str,
    now_ms: i64,
) -> Result<Vec<u8>, EmulatorError> {
    if let Some(raw) = &message.raw {
        return Ok(raw.replace("\r\n", "\n").replace('\n', "\r\n").into_bytes());
    }

    let from = message.from.as_deref().unwrap_or("sender@example.com");
    let to = message.to.as_deref().unwrap_or(mailbox);
    let date_seconds = message.date.map_or(now_ms / 1000, |date| date.timestamp());
    let message_id = message
        .message_id
        .clone()
        .unwrap_or_else(|| default_message_id.to_string());

    let mut builder = MessageBuilder::new()
        .from(builder_addresses(from)?)
        .to(builder_addresses(to)?)
        .subject(message.subject.clone().unwrap_or_default())
        .date(date_seconds)
        .message_id(message_id);

    if let Some(cc) = &message.cc {
        builder = builder.cc(builder_addresses(cc)?);
    }
    if let Some(parent) = &message.in_reply_to {
        builder = builder
            .in_reply_to(parent.clone())
            .references(parent.clone());
    }
    if let Some(html) = &message.html {
        builder = builder.html_body(html.clone());
    }
    if message.text.is_some() || message.html.is_none() {
        builder = builder.text_body(message.text.clone().unwrap_or_default());
    }

    for attachment in &message.attachments {
        let bytes = match (&attachment.base64, &attachment.text) {
            (Some(encoded), _) => STANDARD.decode(encoded).map_err(|error| {
                EmulatorError::InvalidMessage(format!(
                    "attachment `{}` is not base64: {error}",
                    attachment.filename
                ))
            })?,
            (None, Some(text)) => text.clone().into_bytes(),
            (None, None) => Vec::new(),
        };
        builder = builder.attachment(
            attachment
                .mime_type
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_string()),
            attachment.filename.clone(),
            bytes,
        );
    }

    builder
        .write_to_vec()
        .map_err(|error| EmulatorError::InvalidMessage(error.to_string()))
}

/// Decodes the `raw` field of a Gmail request: base64url, padded or not.
pub(crate) fn decode_raw(raw: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(raw.trim_end_matches('='))
        .or_else(|_| STANDARD.decode(raw))
        .ok()
}

/// The message without one header, as Gmail strips `Bcc` from delivered mail.
pub(crate) fn without_header(raw: &[u8], name: &str) -> Vec<u8> {
    let Ok((headers, body_offset)) = mailparse::parse_headers(raw) else {
        return raw.to_vec();
    };

    let mut output = Vec::with_capacity(raw.len());
    for header in headers
        .iter()
        .filter(|header| !header.get_key_ref().eq_ignore_ascii_case(name))
    {
        output.extend_from_slice(header.get_key_raw());
        output.extend_from_slice(b": ");
        output.extend_from_slice(header.get_value_raw());
        output.extend_from_slice(b"\r\n");
    }
    output.extend_from_slice(b"\r\n");
    output.extend_from_slice(&raw[body_offset..]);
    output
}

/// Parses RFC 822 bytes into the stored form.
pub(crate) fn parse(raw: &[u8]) -> Result<Parsed, EmulatorError> {
    let mail = mailparse::parse_mail(raw)
        .map_err(|error| EmulatorError::InvalidMessage(error.to_string()))?;
    let payload = part(&mail, String::new());

    let mut texts = Vec::new();
    let mut html = Vec::new();
    let mut has_attachment = false;
    collect_text(&payload, &mut texts, &mut html, &mut has_attachment);
    let body_text = match texts.first() {
        Some(text) => text.clone(),
        None => html
            .first()
            .map(|html| strip_tags(html))
            .unwrap_or_default(),
    };

    let message_id = header(&payload.headers, "Message-ID").map(strip_angle_brackets);
    let replies_to = ["In-Reply-To", "References"]
        .iter()
        .filter_map(|name| header(&payload.headers, name))
        .flat_map(|value| value.split_whitespace().map(strip_angle_brackets))
        .collect();
    let search_text = ["Subject", "From", "To", "Cc"]
        .iter()
        .filter_map(|name| header(&payload.headers, name))
        .chain([body_text.as_str()])
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    Ok(Parsed {
        snippet: snippet(&body_text),
        message_id,
        replies_to,
        search_text,
        has_attachment,
        payload,
    })
}

fn strip_angle_brackets(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .to_string()
}

fn part(mail: &ParsedMail<'_>, part_id: String) -> Part {
    let disposition = mail.get_content_disposition();
    let filename = disposition
        .params
        .get("filename")
        .or_else(|| mail.ctype.params.get("name"))
        .cloned()
        .unwrap_or_default();
    let mime_type = mail.ctype.mimetype.to_lowercase();
    let is_multipart = mime_type.starts_with("multipart/");
    let is_attachment = !is_multipart
        && (disposition.disposition == DispositionType::Attachment || !filename.is_empty());

    let child_id = |index: usize| match part_id.as_str() {
        "" => index.to_string(),
        parent => format!("{parent}.{index}"),
    };
    let mut parts: Vec<Part> = mail
        .subparts
        .iter()
        .enumerate()
        .map(|(index, child)| part(child, child_id(index)))
        .collect();
    // Gmail lists the message a `message/rfc822` part wraps, such as the
    // original a bounce returns, as that part's one child.
    let wrapped = match mime_type == "message/rfc822" && !is_attachment {
        true => mail
            .get_body_raw()
            .ok()
            .filter(|raw| !raw.trim_ascii().is_empty()),
        false => None,
    };
    if let Some(inner) = wrapped
        .as_deref()
        .and_then(|raw| mailparse::parse_mail(raw).ok())
    {
        parts.push(part(&inner, child_id(0)));
    }
    let is_container = is_multipart || !parts.is_empty();

    Part {
        part_id,
        mime_type,
        filename,
        headers: mail
            .headers
            .iter()
            .map(|header| (header.get_key(), header.get_value()))
            .collect(),
        body: match is_container {
            true => Vec::new(),
            false => mail.get_body_raw().unwrap_or_default(),
        },
        is_attachment,
        parts,
    }
}

fn collect_text(
    part: &Part,
    texts: &mut Vec<String>,
    html: &mut Vec<String>,
    has_attachment: &mut bool,
) {
    if part.is_attachment {
        *has_attachment = true;
    } else if part.mime_type == "text/plain" {
        texts.push(String::from_utf8_lossy(&part.body).into_owned());
    } else if part.mime_type == "text/html" {
        html.push(String::from_utf8_lossy(&part.body).into_owned());
    }

    // The snippet, search text and attachment mark are the message's own,
    // not those of a message it wraps.
    if part.mime_type == "message/rfc822" {
        return;
    }
    for child in &part.parts {
        collect_text(child, texts, html, has_attachment);
    }
}

fn strip_tags(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            other if !in_tag => text.push(other),
            _ => {}
        }
    }
    text
}

fn snippet(body_text: &str) -> String {
    body_text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(SNIPPET_CHARS)
        .collect()
}

/// How much of a message a Gmail `format` returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
pub(crate) enum Format {
    Full,
    Metadata,
    Minimal,
    Raw,
}

/// The attachment id Gmail would return for a part. Like Gmail's, it differs
/// on every fetch (`nonce`) and still resolves to the same part.
fn attachment_id(part_id: &str, nonce: u64) -> String {
    URL_SAFE_NO_PAD.encode(format!("{part_id}:{nonce}"))
}

/// The part id an attachment id names.
pub(crate) fn attachment_part_id(attachment_id: &str) -> Option<String> {
    let decoded = URL_SAFE_NO_PAD.decode(attachment_id).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (part_id, _) = text.rsplit_once(':')?;
    Some(part_id.to_string())
}

pub(crate) fn find_part<'a>(part: &'a Part, part_id: &str) -> Option<&'a Part> {
    if part.part_id == part_id {
        return Some(part);
    }
    part.parts
        .iter()
        .find_map(|child| find_part(child, part_id))
}

/// Encodes body bytes the way Gmail does: padded base64url.
pub(crate) fn encode_body(bytes: &[u8]) -> String {
    URL_SAFE.encode(bytes)
}

/// A part as Gmail's `MessagePart` JSON.
pub(crate) fn part_json(part: &Part, format: Format, nonce: u64) -> Value {
    let headers: Vec<Value> = part
        .headers
        .iter()
        .map(|(name, value)| json!({ "name": name, "value": value }))
        .collect();
    let mut value = json!({
        "partId": part.part_id,
        "mimeType": part.mime_type,
        "filename": part.filename,
        "headers": headers,
    });

    if format == Format::Full {
        value["body"] = if part.is_attachment {
            json!({
                "attachmentId": attachment_id(&part.part_id, nonce),
                "size": part.body.len(),
            })
        } else if part.body.is_empty() {
            json!({ "size": 0 })
        } else {
            json!({ "size": part.body.len(), "data": encode_body(&part.body) })
        };
        if !part.parts.is_empty() {
            value["parts"] = part
                .parts
                .iter()
                .map(|child| part_json(child, format, nonce))
                .collect();
        }
    }

    value
}

#[cfg(test)]
mod test;
