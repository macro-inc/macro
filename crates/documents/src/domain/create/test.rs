use std::sync::Mutex;

use activity::Attribution;
use macro_user_id::user_id::MacroUserIdStr;

use super::{DocumentCreator, MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument};
use crate::domain::content::DocumentContent;
use crate::domain::models::{CreateDocumentRepoArgs, CreateTaskRequest, DocumentError};
use crate::domain::ports::create::{
    DocumentBytesUpload, DocumentBytesUploadPort, DocumentCreationService,
};
use crate::domain::ports::markdown::MarkdownInitializationPort;
use crate::domain::ports::mentions::DocumentMentionTrackingPort;
use crate::domain::response::{
    CreateDocumentResponseData, DocumentResponse, DocumentResponseMetadataWithContent,
};
use model::document::response::DocumentResponseMetadata;

const DOCUMENT_ID: &str = "created-task";
const EMAIL_SEED: &str = r#"<m-document-mention>{"documentId":"thread-7","blockName":"email","documentName":"Re: invoice"}</m-document-mention>"#;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap()
}

struct FakeCreationService;

impl DocumentCreationService for FakeCreationService {
    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        _args: CreateDocumentRepoArgs,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        Ok(CreateDocumentResponseData {
            document_response: DocumentResponse {
                document_metadata: DocumentResponseMetadataWithContent::new(
                    DocumentResponseMetadata {
                        document_id: DOCUMENT_ID.to_string(),
                        document_version_id: 1,
                        owner: user_id,
                        document_name: "task".to_string(),
                        file_type: Some("md".to_string()),
                        sha: None,
                        branched_from_id: None,
                        branched_from_version_id: None,
                        document_family_id: None,
                        document_bom: None,
                        modification_data: None,
                        created_at: None,
                        updated_at: None,
                        sub_type: None,
                    },
                    DocumentContent::pending(),
                ),
                presigned_url: None,
            },
            content_type: "text/markdown".to_string(),
            file_type: Some("md".to_string()),
        })
    }

    async fn handle_task_properties(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _document_id: &str,
        _request: &CreateTaskRequest,
        _attribution: &Attribution,
    ) -> Result<(), DocumentError> {
        Ok(())
    }

    async fn mark_document_uploaded(&self, _document_id: &str) -> Result<(), DocumentError> {
        panic!("unexpected mark_document_uploaded call")
    }

    async fn set_document_content(
        &self,
        _document_id: &str,
        _content: DocumentContent,
    ) -> Result<(), DocumentError> {
        Ok(())
    }

    async fn cleanup_created_document(&self, _document_id: &str) {
        panic!("unexpected cleanup_created_document call")
    }
}

struct FakeMarkdownInitializer;

impl MarkdownInitializationPort for FakeMarkdownInitializer {
    async fn initialize_existing_markdown(
        &self,
        _document_id: &str,
        _markdown: &str,
    ) -> Result<Vec<u8>, DocumentError> {
        Ok(vec![1, 2, 3])
    }
}

struct FakeBytesUploader;

impl DocumentBytesUploadPort for FakeBytesUploader {
    async fn upload_document_bytes(
        &self,
        _upload: DocumentBytesUpload,
    ) -> Result<(), DocumentError> {
        panic!("unexpected upload_document_bytes call")
    }
}

#[derive(Default)]
struct RecordingMentionTracker {
    calls: Mutex<Vec<(String, String, String)>>,
    fail: bool,
}

impl RecordingMentionTracker {
    fn failing() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            fail: true,
        }
    }

    fn calls(&self) -> Vec<(String, String, String)> {
        self.calls.lock().unwrap().clone()
    }
}

impl DocumentMentionTrackingPort for &RecordingMentionTracker {
    async fn track_document_mentions(
        &self,
        document_id: &str,
        user_id: &MacroUserIdStr<'static>,
        markdown: &str,
    ) -> anyhow::Result<()> {
        self.calls.lock().unwrap().push((
            document_id.to_string(),
            user_id.as_ref().to_string(),
            markdown.to_string(),
        ));
        if self.fail {
            anyhow::bail!("lexical service unavailable");
        }
        Ok(())
    }
}

fn task_document(markdown: &str) -> NewMarkdownTextDocument {
    NewMarkdownTextDocument {
        metadata: NewDocumentMetadata::new("task"),
        markdown: markdown.to_string(),
        subtype: MarkdownSubtype::Task {
            property_values: None,
            share_with_team: false,
            team_id: None,
        },
    }
}

#[tokio::test]
async fn markdown_creation_tracks_the_seeded_mentions_once() {
    let tracker = RecordingMentionTracker::default();
    let creator = DocumentCreator::new(
        FakeCreationService,
        FakeMarkdownInitializer,
        FakeBytesUploader,
        &tracker,
    );

    creator
        .create_markdown_text(owner(), task_document(EMAIL_SEED))
        .await
        .expect("creation should succeed");

    assert_eq!(
        tracker.calls(),
        vec![(
            DOCUMENT_ID.to_string(),
            "macro|owner@example.com".to_string(),
            EMAIL_SEED.to_string(),
        )]
    );
}

#[tokio::test]
async fn mention_tracking_failure_does_not_fail_creation() {
    let tracker = RecordingMentionTracker::failing();
    let creator = DocumentCreator::new(
        FakeCreationService,
        FakeMarkdownInitializer,
        FakeBytesUploader,
        &tracker,
    );

    let created = creator
        .create_markdown_text(owner(), task_document(EMAIL_SEED))
        .await
        .expect("creation should survive a mention tracking failure");

    assert_eq!(created.initial_snapshot(), Some([1, 2, 3].as_slice()));
    assert_eq!(tracker.calls().len(), 1);
}
