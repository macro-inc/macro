use super::*;
use model::document::FileType;
use sqs_client::search::document::SearchExtractorMessage;

#[test]
fn test_deserialize_search_extractor_message() {
    let message = serde_json::json!({
        "user_id": "user_id",
        "document_id": "document_id",
        "file_type": "pdf"
    });
    let message: SearchExtractorMessage = serde_json::from_value(message).unwrap();

    assert_eq!(
        message,
        SearchExtractorMessage {
            user_id: "user_id".to_string(),
            document_id: "document_id".to_string(),
            file_type: FileType::Pdf,
            document_version_id: None,
        }
    );

    let message = serde_json::json!({
        "user_id": "user_id",
        "document_id": "document_id",
        "file_type": "docx",
        "document_version_id": "1"
    });
    let message: SearchExtractorMessage = serde_json::from_value(message).unwrap();

    assert_eq!(
        message,
        SearchExtractorMessage {
            user_id: "user_id".to_string(),
            document_id: "document_id".to_string(),
            file_type: FileType::Docx,
            document_version_id: Some("1".to_string()),
        }
    );

    let message = serde_json::json!({
        "user_id": "user_id",
        "document_id": "document_id",
        "file_type": "BAD ONE"
    });
    let error = serde_json::from_value::<SearchExtractorMessage>(message).unwrap_err();

    assert!(error.to_string().starts_with("unknown variant `BAD ONE`"));
}

#[test]
fn test_deserialize_search_queue_message() -> anyhow::Result<()> {
    let message_str = r#"{"ExtractDocumentText":{"user_id":"macro|teo@macro.com","document_id":"253880fb-77d4-4e6c-856d-9f52c2d9a8b0","file_type":"md","document_version_id":"565533"}}"#;

    let search_extractor_message: SearchQueueMessage =
        serde_json::from_str(message_str).context("failed to deserialize message")?;

    assert_eq!(
        search_extractor_message,
        SearchQueueMessage::ExtractDocumentText(SearchExtractorMessage {
            user_id: "macro|teo@macro.com".to_string(),
            document_id: "253880fb-77d4-4e6c-856d-9f52c2d9a8b0".to_string(),
            file_type: FileType::Md,
            document_version_id: Some("565533".to_string()),
        })
    );

    Ok(())
}
