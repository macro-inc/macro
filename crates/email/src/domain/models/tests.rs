use super::*;
use std::str::FromStr;

#[test]
fn test_preview_view_display() {
    assert_eq!(
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox).to_string(),
        "inbox"
    );
    assert_eq!(
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent).to_string(),
        "sent"
    );
    assert_eq!(
        PreviewView::UserLabel("mytag".to_string()).to_string(),
        "user:mytag"
    );
}

#[test]
fn test_preview_view_from_str() {
    assert_eq!(
        PreviewView::from_str("inbox").unwrap(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
    );
    assert_eq!(
        PreviewView::from_str("SENT").unwrap(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent)
    );
    assert_eq!(
        PreviewView::from_str("user:mytag").unwrap(),
        PreviewView::UserLabel("mytag".to_string())
    );
    assert!(PreviewView::from_str("invalid").is_err());
}

#[test]
fn test_preview_view_serialization() {
    assert_eq!(
        serde_json::to_string(&PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox))
            .unwrap(),
        "\"inbox\""
    );
    assert_eq!(
        serde_json::to_string(&PreviewView::StandardLabel(PreviewViewStandardLabel::Sent)).unwrap(),
        "\"sent\""
    );
    assert_eq!(
        serde_json::to_string(&PreviewView::UserLabel("mytag".to_string())).unwrap(),
        "\"user:mytag\""
    );
}

#[test]
fn test_preview_view_deserialization() {
    assert_eq!(
        serde_json::from_str::<PreviewView>("\"inbox\"").unwrap(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
    );
    assert_eq!(
        serde_json::from_str::<PreviewView>("\"SENT\"").unwrap(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent)
    );
    assert_eq!(
        serde_json::from_str::<PreviewView>("\"user:mytag\"").unwrap(),
        PreviewView::UserLabel("mytag".to_string())
    );
    assert!(serde_json::from_str::<PreviewView>("\"invalid\"").is_err());
}

fn link_label(provider_label_id: &str, name: &str, type_: LabelType) -> LinkLabel {
    LinkLabel {
        id: uuid::Uuid::new_v4(),
        link_id: uuid::Uuid::nil(),
        provider_label_id: provider_label_id.to_owned(),
        name: name.to_owned(),
        created_at: chrono::Utc::now(),
        message_list_visibility: MessageListVisibility::Show,
        label_list_visibility: LabelListVisibility::LabelShow,
        type_,
    }
}

#[test]
fn labels_are_found_by_system_id_before_display_name_ignoring_case() {
    let labels = vec![
        link_label("Label_7", "inbox", LabelType::User),
        link_label("INBOX", "INBOX", LabelType::System),
        link_label("Label_9", "Finance", LabelType::User),
    ];
    assert_eq!(
        LinkLabel::find(&labels, " Inbox ").unwrap().id,
        labels[1].id
    );
    assert_eq!(
        LinkLabel::find(&labels, "finance").unwrap().id,
        labels[2].id
    );
    // A user label is never matched by its provider id.
    assert!(LinkLabel::find(&labels, "label_9").is_none());
    assert!(LinkLabel::find(&labels, "Receipts").is_none());
}
