use super::*;

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
