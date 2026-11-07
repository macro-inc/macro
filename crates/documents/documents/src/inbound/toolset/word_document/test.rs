use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn word_document_tools_have_valid_model_schemas() {
    assert!(generate_validated_input_schema::<ReadWordDocument>().is_ok());
    assert!(generate_validated_input_schema::<EditWordDocument>().is_ok());
}

#[test]
fn edit_input_parses_every_operation() {
    let tool: EditWordDocument = serde_json::from_value(serde_json::json!({
        "documentId": "doc",
        "operations": [
            { "type": "replaceText", "paragraph": "p1", "find": "two", "replace": "three" },
            { "type": "setText", "paragraph": "p1", "text": "New" },
            { "type": "formatText", "paragraph": "p1", "find": "New", "bold": true },
            { "type": "insertParagraph", "after": "p1", "text": "A\nB", "style": "Heading2" },
            { "type": "setStyle", "paragraph": "p1", "style": "Title" },
            { "type": "delete", "id": "t1" },
            { "type": "addComment", "paragraph": "p1", "find": "New", "text": "Why?" },
        ],
    }))
    .unwrap();
    assert_eq!(tool.operations.len(), 7);
    assert_eq!(tool.track_changes, None);
    assert_eq!(tool.author, None);
}

#[test]
fn edit_input_takes_tracking_and_an_author() {
    let tool: EditWordDocument = serde_json::from_value(serde_json::json!({
        "documentId": "doc",
        "operations": [{ "type": "delete", "id": "p1" }],
        "trackChanges": true,
        "author": "Acme Legal",
    }))
    .unwrap();
    assert_eq!(tool.track_changes, Some(true));
    assert_eq!(tool.author.as_deref(), Some("Acme Legal"));
}

#[tokio::test]
async fn cancelled_request_never_starts_the_worker_operation() {
    let req = RequestContext::new(
        macro_user_id::user_id::MacroUserIdStr::try_from("macro|test@example.com".to_owned())
            .unwrap(),
    );
    req.cancel.cancel();
    let started = std::sync::atomic::AtomicBool::new(false);
    let error = cancellable(&req, async {
        started.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    })
    .await
    .unwrap_err();
    assert!(!started.load(std::sync::atomic::Ordering::SeqCst));
    assert!(error.description.contains("cancelled"));
}
