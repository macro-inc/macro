use super::*;
use crate::inbound::toolset::edit_document::test::{
    FakeDocumentService, FakeEditingWorker, request_context, tool_context,
};

#[tokio::test]
async fn native_canvas_tool_rejects_legacy_payloads_before_creating_metadata() {
    for (file_content, is_task) in [(r#"{"version":2,"document":{}}"#, false), ("", true)] {
        let context = tool_context(
            FakeDocumentService::new("canvas"),
            FakeEditingWorker::default(),
        );
        let tool = CreateDocument {
            document_name: "Fresh Canvas".into(),
            file_extension: "canvas".into(),
            file_content: file_content.into(),
            is_task,
            project_id: None,
        };
        // The shared fake panics if creation or team lookup is reached.
        assert!(tool.call(context, request_context()).await.is_err());
    }
}
