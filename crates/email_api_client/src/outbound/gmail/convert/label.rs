use models_email::gmail::labels::{GmailLabel, GmailLabelsResponse};
use models_email::service::label::{Label, LabelListVisibility, LabelType, MessageListVisibility};
use uuid::Uuid;

use crate::domain::models::EmailApiError;

pub(crate) fn map_label_to_service(
    gmail_label: &GmailLabel,
    link_id: Uuid,
) -> Result<Label, EmailApiError> {
    let message_list_visibility = gmail_label
        .message_list_visibility
        .as_deref()
        .map(MessageListVisibility::from_str)
        .transpose()
        .map_err(permanent)?
        .unwrap_or(MessageListVisibility::Show);
    let label_list_visibility = gmail_label
        .label_list_visibility
        .as_deref()
        .map(LabelListVisibility::from_str)
        .transpose()
        .map_err(permanent)?
        .unwrap_or(LabelListVisibility::LabelShow);
    let label_type = gmail_label
        .type_
        .as_deref()
        .map(LabelType::from_str)
        .transpose()
        .map_err(permanent)?
        .unwrap_or(LabelType::User);

    Ok(Label {
        id: None,
        link_id,
        provider_label_id: gmail_label.id.clone().unwrap_or_default(),
        name: Some(gmail_label.name.clone()),
        created_at: chrono::Utc::now(),
        message_list_visibility: Some(message_list_visibility),
        label_list_visibility: Some(label_list_visibility),
        type_: Some(label_type),
    })
}

pub(crate) fn map_labels_to_service(
    response: &GmailLabelsResponse,
    link_id: Uuid,
) -> Result<Vec<Label>, EmailApiError> {
    response
        .labels
        .iter()
        .map(|label| map_label_to_service(label, link_id))
        .collect()
}

fn permanent(message: String) -> EmailApiError {
    EmailApiError::Permanent { message }
}

#[cfg(test)]
mod test;
