use std::str::FromStr;
use std::sync::Mutex;

use documents::domain::content::{DocumentContent, DocumentContentLocation, DocumentContentState};
use documents::domain::legacy_office_upgrade::{
    LegacyOfficeUpgradeRequest, UpgradedObjectDestination,
};
use documents::domain::models::DocumentError;
use model::document::DocumentBasic;
use model_owner::Owner;

use super::*;

const OWNER: &str = "macro|owner@macro.com";
const DOCUMENT_ID: &str = "01a0914f-1fde-7873-80ba-6eef315d3b50";
const BUCKET: &str = "document-storage";

#[derive(Clone, Debug, PartialEq)]
enum Call {
    SetContent(DocumentContentState, Option<DocumentContentLocation>),
    RequestUpgrade(LegacyOfficeUpgradeRequest),
    Promote(FileType, UpgradedObjectDestination),
    Swap(FileType, FileType),
    CreateInstance,
    CreateBom,
}

#[derive(Default)]
struct Log(Mutex<Vec<Call>>);

impl Log {
    fn push(&self, call: Call) {
        self.0.lock().unwrap().push(call);
    }
    fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().clone()
    }
}

struct FakeDocuments<'a> {
    log: &'a Log,
    file_type: Mutex<Option<String>>,
    content: DocumentContent,
}

impl FakeDocuments<'_> {
    fn document(&self) -> DocumentBasic {
        DocumentBasic {
            document_id: DOCUMENT_ID.to_string(),
            document_name: "Upload".to_string(),
            owner: Owner::from_principal_str(OWNER).unwrap(),
            file_type: self.file_type.lock().unwrap().clone(),
            sub_type: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            project_id: None,
            deleted_at: None,
        }
    }
}

impl DocumentUploadMetadataPort for FakeDocuments<'_> {
    async fn get_basic_document(
        &self,
        document_id: &str,
    ) -> Result<Option<DocumentBasic>, DocumentError> {
        assert_eq!(document_id, DOCUMENT_ID);
        Ok(Some(self.document()))
    }
}

impl UploadFinalizeDocumentPort for FakeDocuments<'_> {
    async fn get_document_content(
        &self,
        _document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        Ok(self.content.clone())
    }

    async fn mark_document_uploaded(&self, _document_id: &str) -> Result<(), DocumentError> {
        Ok(())
    }

    async fn set_document_content(
        &self,
        _document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        self.log
            .push(Call::SetContent(content.state, content.location));
        Ok(())
    }
}

impl LegacyOfficeUpgradeRepoPort for FakeDocuments<'_> {
    async fn create_document_instance(
        &self,
        _document_id: &str,
        _sha: &str,
    ) -> Result<i64, DocumentError> {
        self.log.push(Call::CreateInstance);
        Ok(99)
    }

    async fn delete_document_instance(&self, _version_id: i64) -> Result<(), DocumentError> {
        Ok(())
    }

    async fn create_document_bom(&self, _document_id: &str) -> Result<i64, DocumentError> {
        self.log.push(Call::CreateBom);
        Ok(5)
    }

    async fn delete_document_bom(&self, _bom_id: i64) -> Result<(), DocumentError> {
        Ok(())
    }

    async fn swap_document_file_type(
        &self,
        _document_id: &str,
        from: FileType,
        to: FileType,
    ) -> Result<bool, DocumentError> {
        self.log.push(Call::Swap(from, to));
        let mut stored = self.file_type.lock().unwrap();
        if stored.as_deref() != Some(from.as_str()) {
            return Ok(false);
        }
        *stored = Some(to.as_str().to_string());
        Ok(true)
    }

    async fn set_document_content(
        &self,
        _document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        self.log
            .push(Call::SetContent(content.state, content.location));
        Ok(())
    }
}

struct FakeObjects;

impl DocumentObjectReader for FakeObjects {
    async fn read_utf8_object(&self, _bucket: &str, _key: &str) -> Result<String, anyhow::Error> {
        Ok("# markdown".to_string())
    }
}

struct FakeUpgradeStorage<'a> {
    log: &'a Log,
}

impl LegacyOfficeUpgradeStoragePort for FakeUpgradeStorage<'_> {
    async fn request_upgrade(
        &self,
        request: &LegacyOfficeUpgradeRequest,
    ) -> Result<(), DocumentError> {
        self.log.push(Call::RequestUpgrade(request.clone()));
        Ok(())
    }

    async fn upgraded_object_sha(
        &self,
        _owner: &Owner,
        _document_id: &str,
        _target: FileType,
    ) -> Result<String, DocumentError> {
        Ok("sha".to_string())
    }

    async fn promote_upgraded_object(
        &self,
        _owner: &Owner,
        _document_id: &str,
        target: FileType,
        destination: UpgradedObjectDestination,
    ) -> Result<(), DocumentError> {
        self.log.push(Call::Promote(target, destination));
        Ok(())
    }
}

struct NoMarkdown;

impl MarkdownInitializationPort for NoMarkdown {
    async fn initialize_existing_markdown(
        &self,
        _document_id: &str,
        _markdown: &str,
    ) -> Result<Vec<u8>, DocumentError> {
        Ok(Vec::new())
    }
}

async fn handle(file_type: Option<&str>, content: DocumentContent, key: String) -> Vec<Call> {
    let log = Log::default();
    let finalizer = DocumentUploadFinalizer::new(
        FakeDocuments {
            log: &log,
            file_type: Mutex::new(file_type.map(str::to_string)),
            content,
        },
        FakeObjects,
        FakeUpgradeStorage { log: &log },
    );
    finalizer
        .handle_object_created(
            ObjectCreated {
                bucket: BUCKET.to_string(),
                key,
            },
            &NoMarkdown,
        )
        .await
        .unwrap();
    log.calls()
}

fn versioned_key(version_id: i64) -> String {
    format!("{OWNER}/{DOCUMENT_ID}/{version_id}")
}

fn upgraded_key(extension: &str) -> String {
    format!("{OWNER}/{DOCUMENT_ID}/upgraded.{extension}")
}

#[tokio::test]
async fn legacy_upload_is_finalized_then_upgrade_requested() {
    for (legacy, target) in [
        ("ppt", FileType::Pptx),
        ("doc", FileType::Docx),
        ("xls", FileType::Xlsx),
    ] {
        let calls = handle(Some(legacy), DocumentContent::pending(), versioned_key(12)).await;

        assert_eq!(
            calls,
            vec![
                Call::SetContent(
                    DocumentContentState::Ready,
                    Some(DocumentContentLocation::ObjectStorage)
                ),
                Call::RequestUpgrade(LegacyOfficeUpgradeRequest {
                    owner: Owner::from_principal_str(OWNER).unwrap(),
                    document_id: DOCUMENT_ID.to_string(),
                    source_version_id: 12,
                    from: FileType::from_str(legacy).unwrap(),
                    to: target,
                }),
            ],
            "{legacy}"
        );
    }
}

#[tokio::test]
async fn modern_uploads_request_no_upgrade() {
    for file_type in ["pptx", "xlsx", "xlsm", "pdf"] {
        let calls = handle(
            Some(file_type),
            DocumentContent::pending(),
            versioned_key(3),
        )
        .await;

        assert!(
            !calls
                .iter()
                .any(|call| matches!(call, Call::RequestUpgrade(_))),
            "{file_type}: {calls:?}"
        );
    }
}

#[tokio::test]
async fn copied_upgrade_version_requests_nothing() {
    // The copy into a versioned key fires after the type was swapped.
    let calls = handle(
        Some("pptx"),
        DocumentContent::ready(DocumentContentLocation::ObjectStorage),
        versioned_key(99),
    )
    .await;

    assert!(calls.is_empty(), "{calls:?}");
}

#[tokio::test]
async fn upgraded_presentation_becomes_the_current_version() {
    let calls = handle(
        Some("ppt"),
        DocumentContent::ready(DocumentContentLocation::ObjectStorage),
        upgraded_key("pptx"),
    )
    .await;

    assert_eq!(
        calls,
        vec![
            Call::CreateInstance,
            Call::Swap(FileType::Ppt, FileType::Pptx),
            Call::Promote(
                FileType::Pptx,
                UpgradedObjectDestination::DocumentVersion { version_id: 99 }
            ),
            Call::SetContent(
                DocumentContentState::Ready,
                Some(DocumentContentLocation::ObjectStorage)
            ),
        ]
    );
}

#[tokio::test]
async fn upgraded_word_document_is_staged_for_the_docx_pipeline() {
    let calls = handle(
        Some("doc"),
        DocumentContent::ready(DocumentContentLocation::ObjectStorage),
        upgraded_key("docx"),
    )
    .await;

    assert_eq!(
        calls,
        vec![
            Call::CreateBom,
            Call::Swap(FileType::Doc, FileType::Docx),
            Call::SetContent(
                DocumentContentState::Pending,
                Some(DocumentContentLocation::ConvertedPdf)
            ),
            Call::Promote(
                FileType::Docx,
                UpgradedObjectDestination::DocxStaging { bom_id: 5 }
            ),
        ]
    );
}

#[tokio::test]
async fn redelivered_upgrade_is_skipped() {
    let calls = handle(
        Some("xlsx"),
        DocumentContent::ready(DocumentContentLocation::ObjectStorage),
        upgraded_key("xlsx"),
    )
    .await;

    assert!(calls.is_empty(), "{calls:?}");
}

#[tokio::test]
async fn unparseable_keys_are_ignored() {
    for key in [
        format!("{OWNER}/{DOCUMENT_ID}/upgraded.doc"),
        format!("{OWNER}/{DOCUMENT_ID}/notes.txt"),
    ] {
        let calls = handle(Some("doc"), DocumentContent::pending(), key.clone()).await;
        assert!(calls.is_empty(), "{key}");
    }
}
