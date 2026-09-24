use std::sync::Mutex;

use bot_id::{BotId, NonSystemBotId};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use model_owner::CreationPrincipal;

use super::{
    DocumentCreator, MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument,
    NewPlainTextDocument, RepoDocumentKind, RepoDocumentSubtype, file_shas,
};
use crate::domain::content::DocumentContent;
use crate::domain::models::{CreateTaskRequest, DocumentError, InitialLinkShare, NewDocument};
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

fn team_bot() -> CreationPrincipal {
    CreationPrincipal::TeamBot {
        bot: NonSystemBotId::new(BotId::TEST_A).unwrap(),
        team: uuid::Uuid::from_u128(7),
    }
}

#[derive(Default)]
struct FakeCreationService {
    calls: Mutex<Vec<(CreationPrincipal, NewDocument)>>,
    task_principals: Mutex<Vec<CreationPrincipal>>,
}

impl DocumentCreationService for FakeCreationService {
    async fn create_document(
        &self,
        principal: &CreationPrincipal,
        document: NewDocument,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        let file_type = document.file_type.map(|kind| kind.to_string());
        self.calls
            .lock()
            .unwrap()
            .push((principal.clone(), document));
        Ok(CreateDocumentResponseData {
            document_response: DocumentResponse {
                document_metadata: DocumentResponseMetadataWithContent::new(
                    DocumentResponseMetadata {
                        document_id: DOCUMENT_ID.to_string(),
                        document_version_id: 1,
                        owner: principal.owner(),
                        document_name: "task".to_string(),
                        file_type: file_type.clone(),
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
            file_type: file_type.clone(),
        })
    }

    async fn handle_task_properties(
        &self,
        principal: &CreationPrincipal,
        _document_id: &str,
        _request: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        self.task_principals.lock().unwrap().push(principal.clone());
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

fn creator(
    tracker: &RecordingMentionTracker,
) -> DocumentCreator<
    FakeCreationService,
    FakeMarkdownInitializer,
    FakeBytesUploader,
    &RecordingMentionTracker,
> {
    DocumentCreator::new(
        FakeCreationService::default(),
        FakeMarkdownInitializer,
        FakeBytesUploader,
        tracker,
    )
}

fn repo_kind() -> RepoDocumentKind {
    RepoDocumentKind {
        file_type: Some(FileType::Md),
        sha: "sha".to_string(),
        subtype: RepoDocumentSubtype::Regular,
        team_id: None,
        share_with_team: false,
    }
}

#[tokio::test]
async fn markdown_creation_tracks_the_seeded_mentions_once() {
    let tracker = RecordingMentionTracker::default();

    creator(&tracker)
        .create_markdown_text(&CreationPrincipal::User(owner()), task_document(EMAIL_SEED))
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

    let created = creator(&tracker)
        .create_markdown_text(&CreationPrincipal::User(owner()), task_document(EMAIL_SEED))
        .await
        .expect("creation should survive a mention tracking failure");

    assert_eq!(created.initial_snapshot(), Some([1, 2, 3].as_slice()));
    assert_eq!(tracker.calls().len(), 1);
}

#[tokio::test]
async fn a_task_is_created_and_propertied_as_one_principal() {
    let bot_for_user = CreationPrincipal::BotForUser {
        bot: bot_id::MACRO_AI_BOT_ID,
        user: owner(),
    };
    for principal in [CreationPrincipal::User(owner()), bot_for_user, team_bot()] {
        let tracker = RecordingMentionTracker::default();
        let creator = creator(&tracker);

        creator
            .create_markdown_text(&principal, task_document(EMAIL_SEED))
            .await
            .expect("creation should succeed");

        let calls = creator.document_service.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, principal);
        assert_eq!(
            *creator.document_service.task_principals.lock().unwrap(),
            vec![principal.clone()]
        );
    }
}

#[tokio::test]
async fn mentions_are_tracked_only_for_an_acting_user() {
    let bot_for_user = CreationPrincipal::BotForUser {
        bot: bot_id::MACRO_AI_BOT_ID,
        user: owner(),
    };
    for (principal, expected_user) in [
        (bot_for_user, Some("macro|owner@example.com")),
        (team_bot(), None),
    ] {
        let tracker = RecordingMentionTracker::default();

        creator(&tracker)
            .create_markdown_text(&principal, task_document(EMAIL_SEED))
            .await
            .expect("creation should succeed");

        let tracked_users: Vec<String> = tracker
            .calls()
            .into_iter()
            .map(|(_, user, _)| user)
            .collect();
        assert_eq!(
            tracked_users,
            expected_user
                .map(str::to_string)
                .into_iter()
                .collect::<Vec<_>>(),
            "{principal:?}"
        );
    }
}

#[tokio::test]
async fn native_spreadsheet_creation_uses_shared_service_without_upload_or_markdown() {
    let tracker = RecordingMentionTracker::default();
    let creator = creator(&tracker);
    let project = uuid::Uuid::new_v4();
    let principal = CreationPrincipal::BotForUser {
        bot: bot_id::MACRO_AI_BOT_ID,
        user: MacroUserIdStr::try_from_email("owner@macro.com").unwrap(),
    };
    let result = creator
        .create_spreadsheet(
            &principal,
            NewDocumentMetadata::builder("Budget")
                .project_id(project)
                .build(),
        )
        .await
        .unwrap()
        .into_response();
    assert_eq!(result.file_type.as_deref(), Some("spreadsheet"));
    let calls = creator.document_service.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let (called_principal, document) = &calls[0];
    assert_eq!(*called_principal, principal);
    assert_eq!(document.file_type, Some(FileType::Spreadsheet));
    assert_eq!(document.sha, crate::domain::models::EMPTY_SHA256);
    assert_eq!(document.document_name, "Budget");
    assert_eq!(document.project_id, Some(project));
    assert!(document.sub_type.is_none());
    assert!(tracker.calls().is_empty());
}

#[test]
fn link_share_defaults_to_the_entity_default_unless_set_exactly() {
    use models_permissions::share_permission::access_level::AccessLevel;
    use models_permissions::share_permission::{LinkShare, LinkShareState};

    let document = NewDocumentMetadata::new("test").into_new_document(repo_kind());
    assert_eq!(document.initial_link_share, InitialLinkShare::EntityDefault);

    let state = LinkShareState::On {
        scope: LinkShare::Team,
        level: AccessLevel::View,
    };
    let document = NewDocumentMetadata::builder("description")
        .initial_link_share(state)
        .build()
        .into_new_document(repo_kind());
    assert_eq!(document.initial_link_share, InitialLinkShare::Exact(state));
}

#[test]
fn initiative_description_is_a_markdown_only_subtype_without_task_properties() {
    let err = NewPlainTextDocument::builder(NewDocumentMetadata::new("test"))
        .file_type(FileType::Txt)
        .text("hello")
        .markdown_subtype(MarkdownSubtype::InitiativeDescription)
        .build()
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "bad request: initiative descriptions must be markdown documents"
    );

    NewPlainTextDocument::builder(NewDocumentMetadata::new("test"))
        .file_type(FileType::Md)
        .text("# goals")
        .markdown_subtype(MarkdownSubtype::InitiativeDescription)
        .build()
        .unwrap();
    assert_eq!(
        RepoDocumentSubtype::MarkdownInitiativeDescription.sub_type(),
        Some(document_sub_type::DocumentSubType::InitiativeDescription)
    );
}

#[test]
fn new_plain_text_rejects_non_markdown_task() {
    let err = NewPlainTextDocument::builder(NewDocumentMetadata::new("test"))
        .file_type(FileType::Txt)
        .text("hello")
        .markdown_subtype(MarkdownSubtype::from_task_flag(true, None))
        .build()
        .unwrap_err();

    assert_eq!(
        err.to_string(),
        "bad request: tasks must be markdown documents"
    );
}

#[test]
fn new_plain_text_accepts_markdown_task() {
    NewPlainTextDocument::builder(NewDocumentMetadata::new("test"))
        .file_type(FileType::Md)
        .text("# hello")
        .task_flag(true, None)
        .build()
        .unwrap();
}

#[test]
fn task_flag_shares_only_when_a_team_was_resolved() {
    let team_id = uuid::Uuid::from_u128(7);
    for (resolved_team, expected_share) in [(None, false), (Some(team_id), true)] {
        let MarkdownSubtype::Task {
            share_with_team,
            team_id: numbering_team,
            property_values,
        } = MarkdownSubtype::from_task_flag(true, resolved_team)
        else {
            panic!("a task flag builds a task subtype");
        };
        assert_eq!(share_with_team, expected_share);
        assert_eq!(numbering_team, resolved_team);
        assert!(property_values.is_none());
    }
    assert!(matches!(
        MarkdownSubtype::from_task_flag(false, Some(team_id)),
        MarkdownSubtype::Note
    ));
}

#[test]
fn test_file_shas() {
    let hashes = file_shas(b"hello");
    assert_eq!(
        hashes.hex,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    assert_eq!(
        hashes.base64,
        "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="
    );
}
