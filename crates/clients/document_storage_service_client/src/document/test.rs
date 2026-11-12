use serde_json::json;
use shared_types::document::response::{CreateDocumentRequest, EMAIL_ATTACHMENT_NOT_FOUND_CODE};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

use super::CreateDocumentInternalError;
use crate::DocumentStorageServiceClient;

async fn create_answered_by(response: ResponseTemplate) -> Result<(), CreateDocumentInternalError> {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/documents"))
        .respond_with(response)
        .expect(1)
        .mount(&server)
        .await;
    let request = CreateDocumentRequest {
        id: None,
        sha: "sha".to_string(),
        document_name: "contract".to_string(),
        file_type: Some("pdf".to_string()),
        mime_type: Some("application/pdf".to_string()),
        document_family_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        job_id: None,
        project_id: None,
        team_id: None,
        created_at: None,
        email_attachment_id: Some(uuid::Uuid::from_u128(0xA77)),
        is_task: false,
        skip_history: true,
    };
    DocumentStorageServiceClient::new("internal-key".into(), server.uri())
        .create_document_internal(request, "macro|user@example.com")
        .await
        .map(|_| ())
}

#[tokio::test]
async fn a_missing_email_attachment_is_its_own_error() {
    let result = create_answered_by(ResponseTemplate::new(404).set_body_json(json!({
        "code": EMAIL_ATTACHMENT_NOT_FOUND_CODE,
        "message": "email attachment not found",
    })))
    .await;

    assert!(
        matches!(
            result,
            Err(CreateDocumentInternalError::EmailAttachmentNotFound)
        ),
        "got {result:?}"
    );
}

#[tokio::test]
async fn any_other_not_found_stays_a_failure() {
    let result = create_answered_by(
        ResponseTemplate::new(404).set_body_json(json!({ "message": "document not found: x" })),
    )
    .await;

    assert!(
        matches!(result, Err(CreateDocumentInternalError::Internal(_))),
        "got {result:?}"
    );
}
