use mail_builder::MessageBuilder;
use mail_builder::headers::address::Address;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::message::MessageToSend;

use super::EmailApiError;

#[cfg(test)]
mod test;

/// Provider-neutral content and threading metadata for a message send.
#[derive(Debug, Clone)]
pub struct SendRequest {
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
