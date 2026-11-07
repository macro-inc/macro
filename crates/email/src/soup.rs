//! Conversions from email models into their Soup wire shapes.

use crate::domain::models::{
    Attachment, Contact, EmailThreadPreview, EnrichedEmailThreadPreview, Label,
    LabelListVisibility, LabelType, MessageListVisibility,
};
use models_soup::email_thread::{
    SoupAttachment, SoupContact, SoupEmailThreadPreview, SoupEnrichedEmailThreadPreview, SoupLabel,
    SoupLabelListVisibility, SoupLabelType, SoupMessageListVisibility,
};

impl From<Contact> for SoupContact {
    fn from(value: Contact) -> Self {
        Self {
            id: value.id,
            link_id: value.link_id,
            name: value.name,
            email_address: value.email_address,
            sfs_photo_url: value.sfs_photo_url,
        }
    }
}

impl From<Label> for SoupLabel {
    fn from(value: Label) -> Self {
        Self {
            id: value.id,
            link_id: value.link_id,
            provider_label_id: value.provider_label_id,
            name: value.name,
            created_at: value.created_at,
            message_list_visibility: value.message_list_visibility.into(),
            label_list_visibility: value.label_list_visibility.into(),
            type_: value.type_.into(),
        }
    }
}

impl From<MessageListVisibility> for SoupMessageListVisibility {
    fn from(value: MessageListVisibility) -> Self {
        match value {
            MessageListVisibility::Show => Self::Show,
            MessageListVisibility::Hide => Self::Hide,
        }
    }
}

impl From<LabelListVisibility> for SoupLabelListVisibility {
    fn from(value: LabelListVisibility) -> Self {
        match value {
            LabelListVisibility::LabelShow => Self::LabelShow,
            LabelListVisibility::LabelShowIfUnread => Self::LabelShowIfUnread,
            LabelListVisibility::LabelHide => Self::LabelHide,
        }
    }
}

impl From<LabelType> for SoupLabelType {
    fn from(value: LabelType) -> Self {
        match value {
            LabelType::System => Self::System,
            LabelType::User => Self::User,
        }
    }
}

impl From<Attachment> for SoupAttachment {
    fn from(value: Attachment) -> Self {
        Self {
            id: value.id,
            message_id: value.message_id,
            provider_attachment_id: value.provider_attachment_id,
            filename: value.filename,
            mime_type: value.mime_type,
            size_bytes: value.size_bytes,
            content_id: value.content_id,
            created_at: value.created_at,
        }
    }
}

impl From<EmailThreadPreview> for SoupEmailThreadPreview {
    fn from(value: EmailThreadPreview) -> Self {
        Self {
            id: value.id,
            provider_id: value.provider_id,
            owner_id: value.owner_id,
            inbox_visible: value.inbox_visible,
            is_read: value.is_read,
            is_draft: value.is_draft,
            is_important: value.is_important,
            is_signal: value.is_signal,
            name: value.name,
            snippet: value.snippet,
            sender_email: value.sender_email,
            sender_name: value.sender_name,
            sender_photo_url: value.sender_photo_url,
            sort_ts: value.sort_ts,
            created_at: value.created_at,
            updated_at: value.updated_at,
            viewed_at: value.viewed_at,
            project_id: value.project_id,
        }
    }
}

impl From<EnrichedEmailThreadPreview> for SoupEnrichedEmailThreadPreview<()> {
    fn from(preview: EnrichedEmailThreadPreview) -> Self {
        Self {
            thread: preview.thread.into(),
            attachments: preview.attachments.into_iter().map(Into::into).collect(),
            participants: preview.participants.into_iter().map(Into::into).collect(),
            labels: preview.labels.into_iter().map(Into::into).collect(),
            extra: (),
        }
    }
}
