use mail_builder::MessageBuilder;
use mail_builder::headers::address::Address;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::message::MessageToSend;

#[cfg(feature = "ports")]
use super::AccessToken;
use super::EmailApiError;

#[cfg(test)]
mod test;

/// Provider-neutral content and threading metadata for a message send.
#[derive(Debug, Clone)]
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
        if let Some(attachments) = &self.message.attachments {
            for attachment in attachments {
                // Borrow the attachment buffers: cloning them would double
                // peak memory for large-attachment sends.
                builder = builder.attachment(
                    attachment.content_type.as_str(),
                    attachment.file_name.as_str(),
                    &attachment.data[..],
                );
            }
        }

        builder
            .write_to_vec()
            .map_err(|error| EmailApiError::Permanent {
                message: format!("failed to build MIME message: {error}"),
            })
    }
}

/// Locally prepared delivery. Tokens and message contents cannot be logged via
/// `Debug`, and callers cannot construct it without completing preparation.
#[cfg(feature = "ports")]
pub struct PreparedSendMessage {
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
