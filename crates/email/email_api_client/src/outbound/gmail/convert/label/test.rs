use models_email::gmail::labels::{GmailLabel, GmailLabelsResponse};
use models_email::service::label::{LabelListVisibility, LabelType, MessageListVisibility};
use uuid::Uuid;

use super::{map_label_to_service, map_labels_to_service};
use crate::domain::models::EmailApiError;

fn label() -> GmailLabel {
    GmailLabel {
        id: Some("Label_1".into()),
        name: "Projects".into(),
        message_list_visibility: None,
        label_list_visibility: None,
        type_: None,
        color: None,
    }
}

#[test]
fn applies_gmail_label_defaults() {
    let mapped = map_label_to_service(&label(), Uuid::now_v7()).unwrap();

    assert_eq!(
        mapped.message_list_visibility,
        Some(MessageListVisibility::Show)
    );
    assert_eq!(
        mapped.label_list_visibility,
        Some(LabelListVisibility::LabelShow)
    );
    assert_eq!(mapped.type_, Some(LabelType::User));
}

#[test]
fn invalid_wire_values_are_permanent_failures() {
    let mut invalid = label();
    invalid.type_ = Some("invalid".into());

    assert!(matches!(
        map_labels_to_service(
            &GmailLabelsResponse {
                labels: vec![invalid]
            },
            Uuid::now_v7()
        ),
        Err(EmailApiError::Permanent { .. })
    ));
}
