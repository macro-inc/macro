use mail_builder::MessageBuilder;
use mail_builder::headers::address::Address;
use mail_builder::mime::{BodyPart, MimePart};
use models_email::email::service::address::ContactInfo;
use models_email::email::service::attachment::AttachmentToSend;
use models_email::email::service::message::MessageToSend;

#[cfg(feature = "ports")]
use super::AccessToken;
use super::EmailApiError;

#[cfg(test)]
mod test;

/// Provider-neutral content and threading metadata for a message send.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SendRequest {
    /// Stable RFC 5322 Message-ID without angle brackets, for delivery recovery.
    pub message_id: Option<String>,
    /// Message content prepared by the email service.
    pub message: MessageToSend,
    /// Sender shown in the message's `From` header.
    pub from: ContactInfo,
    /// Global message identifier of the direct parent message.
    pub parent_message_id: Option<String>,
    /// Global message identifiers that describe the reply chain.
    pub references: Option<Vec<String>>,
}

impl SendRequest {
    /// Builds the RFC 5322 MIME representation consumed by provider adapters.
    pub fn build_mime(&self) -> Result<Vec<u8>, EmailApiError> {
        let mut builder = MessageBuilder::new()
            .from(contact_to_address(&self.from))
            .to(contacts_to_address_list(self.message.to.as_deref()))
            .cc(contacts_to_address_list(self.message.cc.as_deref()))
            .bcc(contacts_to_address_list(self.message.bcc.as_deref()))
            .subject(&self.message.subject);

        if let Some(message_id) = &self.message_id {
            validate_message_id(message_id)?;
            builder = builder.message_id(message_id.as_str());
        }

        if let Some(parent_message_id) = &self.parent_message_id {
            builder = builder.in_reply_to(parent_message_id.as_str());
        }
        if let Some(references) = &self.references {
            builder = builder.references(references.clone());
        }
        if let Some(text_body) = &self.message.body_text {
            builder = builder.text_body(text_body);
        }
        if let Some(html_body) = &self.message.body_html {
            builder = builder.html_body(html_body);
        }
        let mut calendar_body = None;
        if let Some(attachments) = &self.message.attachments {
            for attachment in attachments {
                if is_calendar_body(attachment) {
                    calendar_body = Some(MimePart::new(
                        attachment.content_type.as_str(),
                        BodyPart::Text(String::from_utf8_lossy(&attachment.data)),
                    ));
                    continue;
                }
                // Borrow the attachment buffers: cloning them would double
                // peak memory for large-attachment sends.
                builder = if attachment.is_inline {
                    builder.inline(
                        attachment.content_type.as_str(),
                        attachment.content_id.as_deref().ok_or_else(|| {
                            EmailApiError::Permanent {
                                message: "Inline attachment requires a Content-ID".into(),
                            }
                        })?,
                        &attachment.data[..],
                    )
                } else {
                    builder.attachment(
                        attachment.content_type.as_str(),
                        attachment.file_name.as_str(),
                        &attachment.data[..],
                    )
                };
            }
        }

        if let Some(calendar) = calendar_body {
            builder.body = Some(with_calendar_body(&mut builder, calendar));
        }

        builder
            .write_to_vec()
            .map_err(|error| EmailApiError::Permanent {
                message: format!("failed to build MIME message: {error}"),
            })
    }
}

/// Whether `attachment` is the message's calendar body rather than a file:
/// an inline `text/calendar` part with no Content-ID, which no HTML body
/// can reference. That is how an invitation (RFC 6047) is sent, and the
/// form Gmail and Outlook answer with Yes, Maybe and No.
fn is_calendar_body(attachment: &AttachmentToSend) -> bool {
    attachment.is_inline
        && attachment.content_id.is_none()
        && attachment
            .content_type
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("text/calendar")
}

/// The body of a message carrying a calendar part: the calendar is the last
/// alternative to the text and HTML bodies, as Google's own invitations
/// send it, with any files after them.
fn with_calendar_body<'x>(
    builder: &mut MessageBuilder<'x>,
    calendar: MimePart<'x>,
) -> MimePart<'x> {
    let mut alternatives: Vec<MimePart<'x>> = [builder.text_body.take(), builder.html_body.take()]
        .into_iter()
        .flatten()
        .collect();
    alternatives.push(calendar);
    let alternative = MimePart::new("multipart/alternative", alternatives);
    match builder.attachments.take() {
        Some(files) if !files.is_empty() => {
            let mut parts = Vec::with_capacity(files.len() + 1);
            parts.push(alternative);
            parts.extend(files);
            MimePart::new("multipart/mixed", parts)
        }
        _ => alternative,
    }
}

/// Locally prepared delivery. Tokens and message contents cannot be logged via
/// `Debug`, and callers cannot construct it without completing preparation.
///
/// It holds the send's admission permit until dispatch finishes it; a delivery
/// dropped without dispatch releases the permit.
#[cfg(feature = "ports")]
pub struct PreparedSendMessage {
    pub(crate) permit: super::RequestPermit,
    pub(crate) access_token: AccessToken,
    pub(crate) mime: Vec<u8>,
    pub(crate) provider_thread_id: Option<String>,
}

pub(crate) fn validate_message_id(message_id: &str) -> Result<(), EmailApiError> {
    let valid = message_id.split_once('@').is_some_and(|(local, domain)| {
        !local.is_empty() && !domain.is_empty() && !domain.contains('@')
    }) && message_id.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'@' | b'.' | b'-' | b'_' | b'+')
    });
    if !valid {
        return Err(EmailApiError::Permanent {
            message: "invalid stable email Message-ID".to_string(),
        });
    }
    Ok(())
}

fn contact_to_address(contact: &ContactInfo) -> Address<'_> {
    Address::new_address(contact.name.as_deref(), contact.email.as_str())
}

fn contacts_to_address_list(contacts: Option<&[ContactInfo]>) -> Address<'_> {
    Address::new_list(
        contacts
            .unwrap_or_default()
            .iter()
            .map(contact_to_address)
            .collect(),
    )
}

/// Provider identifiers returned after a message is accepted for sending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentIds {
    /// Provider identifier assigned to the sent message.
    pub provider_message_id: String,
    /// Provider identifier of the containing thread.
    pub provider_thread_id: String,
}
