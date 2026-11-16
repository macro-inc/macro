//! A message's MIME source, as `GET /me/messages/{id}/$value` answers it.

use mail_builder::MessageBuilder;
use mail_builder::headers::address::Address as MimeAddress;
use mail_builder::mime::{BodyPart, MimePart};

use crate::mailbox::{
    Address, BodyType, IN_REPLY_TO_PROPERTY, Message, REFERENCES_PROPERTY, bare_message_id,
};

fn address(address: &Address) -> MimeAddress<'_> {
    MimeAddress::new_address(address.name.as_deref(), address.address.as_str())
}

fn addresses(list: &[Address]) -> MimeAddress<'_> {
    MimeAddress::new_list(list.iter().map(address).collect())
}

/// Builds the RFC 5322 source of a message. A meeting request carries its
/// iCalendar as the last alternative of the body, as Exchange sends it.
pub(crate) fn source(message: &Message) -> std::io::Result<Vec<u8>> {
    let mut builder = MessageBuilder::new()
        .message_id(bare_message_id(&message.internet_message_id))
        .subject(message.subject.as_str())
        .date(message.sent.unwrap_or(message.received).timestamp())
        .to(addresses(&message.to));
    if let Some(from) = &message.from {
        builder = builder.from(address(from));
    }
    if !message.cc.is_empty() {
        builder = builder.cc(addresses(&message.cc));
    }
    if let Some(parent) = message.property(IN_REPLY_TO_PROPERTY) {
        builder = builder.in_reply_to(bare_message_id(&parent).to_string());
    }
    if let Some(references) = message.property(REFERENCES_PROPERTY) {
        let ids: Vec<String> = references
            .split_whitespace()
            .map(|id| bare_message_id(id).to_string())
            .collect();
        builder = builder.references(ids);
    }

    builder = match message.body_type {
        BodyType::Html => builder
            .text_body(message.plain_text())
            .html_body(message.body.as_str()),
        BodyType::Text => builder.text_body(message.body.as_str()),
    };
    for attachment in &message.attachments {
        builder = match &attachment.content_id {
            Some(content_id) if attachment.inline => builder.inline(
                attachment.content_type.as_str(),
                content_id.as_str(),
                &attachment.bytes[..],
            ),
            _ => builder.attachment(
                attachment.content_type.as_str(),
                attachment.name.as_str(),
                &attachment.bytes[..],
            ),
        };
    }

    if let Some(calendar) = &message.calendar {
        let mut alternatives: Vec<MimePart<'_>> =
            [builder.text_body.take(), builder.html_body.take()]
                .into_iter()
                .flatten()
                .collect();
        alternatives.push(MimePart::new(
            "text/calendar; charset=utf-8; method=REQUEST",
            BodyPart::Text(calendar.as_str().into()),
        ));
        let alternative = MimePart::new("multipart/alternative", alternatives);
        builder.body = Some(match builder.attachments.take() {
            Some(files) if !files.is_empty() => {
                let mut parts = vec![alternative];
                parts.extend(files);
                MimePart::new("multipart/mixed", parts)
            }
            _ => alternative,
        });
    }
    builder.write_to_vec()
}
