use std::str::FromStr;
use std::sync::Mutex;

use super::*;
use crate::domain::content::DocumentContentState;

const DOCUMENT_ID: &str = "doc-1";

#[derive(Clone, Debug, PartialEq)]
enum Call {
    RequestUpgrade(LegacyOfficeUpgradeRequest),
    Sha(FileType),
    Promote(FileType, UpgradedObjectDestination),
    CreateInstance(String),
    DeleteInstance(i64),
    CreateBom,
    DeleteBom(i64),
    Swap(FileType, FileType),
    SetContent(DocumentContentState, Option<DocumentContentLocation>),
}

#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<Call>>,
    /// The document's stored file type, which swaps compare against.
    file_type: Mutex<Option<FileType>>,
    fail_promote: bool,
    fail_sha: bool,
    fail_request: bool,
}

impl Fake {
    fn with_type(file_type: FileType) -> Self {
        Self {
            file_type: Mutex::new(Some(file_type)),
            ..Self::default()
        }
    }

    fn record(&self, call: Call) {
        self.calls.lock().unwrap().push(call);
    }

    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    fn stored_type(&self) -> Option<FileType> {
        *self.file_type.lock().unwrap()
    }
}

fn storage_error() -> DocumentError {
    DocumentError::Internal(anyhow::anyhow!("storage unavailable"))
}

impl LegacyOfficeUpgradeStoragePort for Fake {
    async fn request_upgrade(
        &self,
        request: &LegacyOfficeUpgradeRequest,
    ) -> Result<(), DocumentError> {
        self.record(Call::RequestUpgrade(request.clone()));
        if self.fail_request {
            return Err(storage_error());
        }
        Ok(())
    }

    async fn upgraded_object_sha(
        &self,
        _owner: &Owner,
        _document_id: &str,
        target: FileType,
    ) -> Result<String, DocumentError> {
        self.record(Call::Sha(target));
        if self.fail_sha {
            return Err(storage_error());
        }
        Ok("upgraded-sha".to_string())
    }

    async fn promote_upgraded_object(
        &self,
        _owner: &Owner,
        _document_id: &str,
        target: FileType,
        destination: UpgradedObjectDestination,
    ) -> Result<(), DocumentError> {
        self.record(Call::Promote(target, destination));
        if self.fail_promote {
            return Err(storage_error());
        }
        Ok(())
    }
}

impl LegacyOfficeUpgradeRepoPort for Fake {
    async fn create_document_instance(
        &self,
        _document_id: &str,
        sha: &str,
    ) -> Result<i64, DocumentError> {
        self.record(Call::CreateInstance(sha.to_string()));
        Ok(42)
    }

    async fn delete_document_instance(&self, version_id: i64) -> Result<(), DocumentError> {
        self.record(Call::DeleteInstance(version_id));
        Ok(())
    }

    async fn create_document_bom(&self, _document_id: &str) -> Result<i64, DocumentError> {
        self.record(Call::CreateBom);
        Ok(7)
    }

    async fn delete_document_bom(&self, bom_id: i64) -> Result<(), DocumentError> {
        self.record(Call::DeleteBom(bom_id));
        Ok(())
    }

    async fn swap_document_file_type(
        &self,
        _document_id: &str,
        from: FileType,
        to: FileType,
    ) -> Result<bool, DocumentError> {
        self.record(Call::Swap(from, to));
        let mut stored = self.file_type.lock().unwrap();
        if *stored != Some(from) {
            return Ok(false);
        }
        *stored = Some(to);
        Ok(true)
    }

    async fn set_document_content(
        &self,
        _document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        self.record(Call::SetContent(content.state, content.location));
        Ok(())
    }
}

fn owner() -> Owner {
    Owner::from_principal_str("macro|owner@macro.com").unwrap()
}

fn document(file_type: Option<&str>) -> DocumentBasic {
    DocumentBasic {
        document_id: DOCUMENT_ID.to_string(),
        document_name: "Quarterly".to_string(),
        owner: owner(),
        file_type: file_type.map(str::to_string),
        sub_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

#[test]
fn legacy_types_map_to_openxml_and_back() {
    for (legacy, openxml) in [
        (FileType::Doc, FileType::Docx),
        (FileType::Ppt, FileType::Pptx),
        (FileType::Xls, FileType::Xlsx),
    ] {
        assert_eq!(upgrade_target(legacy), Some(openxml));
        assert_eq!(upgrade_source(openxml), Some(legacy));
    }
}

#[test]
fn other_types_have_no_upgrade() {
    for file_type in [
        FileType::Docx,
        FileType::Pptx,
        FileType::Xlsx,
        FileType::Xlsm,
        FileType::Pdf,
        FileType::Md,
        FileType::Spreadsheet,
    ] {
        assert_eq!(upgrade_target(file_type), None, "{file_type}");
    }
    for file_type in [
        FileType::Doc,
        FileType::Ppt,
        FileType::Xls,
        FileType::Pdf,
        FileType::Xlsm,
    ] {
        assert_eq!(upgrade_source(file_type), None, "{file_type}");
    }
}

#[tokio::test]
async fn requests_upgrade_for_each_legacy_type() {
    for (legacy, openxml) in [
        ("doc", FileType::Docx),
        ("ppt", FileType::Pptx),
        ("xls", FileType::Xlsx),
    ] {
        let fake = Fake::default();
        let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

        let requested = upgrader
            .request_upgrade(&document(Some(legacy)), 11)
            .await
            .unwrap();

        assert!(requested, "{legacy}");
        assert_eq!(
            fake.calls(),
            vec![Call::RequestUpgrade(LegacyOfficeUpgradeRequest {
                owner: owner(),
                document_id: DOCUMENT_ID.to_string(),
                source_version_id: 11,
                from: FileType::from_str(legacy).unwrap(),
                to: openxml,
            })]
        );
    }
}

#[tokio::test]
async fn requests_upgrade_for_uppercase_stored_type() {
    let fake = Fake::default();
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    assert!(
        upgrader
            .request_upgrade(&document(Some("PPT")), 3)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn does_not_request_upgrade_for_modern_or_unknown_types() {
    for file_type in [
        Some("docx"),
        Some("pptx"),
        Some("xlsx"),
        Some("xlsm"),
        Some("pdf"),
        Some("not-a-type"),
        None,
    ] {
        let fake = Fake::default();
        let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

        let requested = upgrader
            .request_upgrade(&document(file_type), 1)
            .await
            .unwrap();

        assert!(!requested, "{file_type:?}");
        assert!(fake.calls().is_empty(), "{file_type:?}");
    }
}

#[tokio::test]
async fn request_failure_is_returned() {
    let fake = Fake {
        fail_request: true,
        ..Fake::default()
    };
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    assert!(
        upgrader
            .request_upgrade(&document(Some("doc")), 1)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn applies_presentation_upgrade_as_new_version() {
    let fake = Fake::with_type(FileType::Ppt);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let outcome = upgrader
        .apply_upgrade(&document(Some("ppt")), FileType::Pptx)
        .await
        .unwrap();

    assert_eq!(outcome, UpgradeOutcome::Applied);
    assert_eq!(fake.stored_type(), Some(FileType::Pptx));
    assert_eq!(
        fake.calls(),
        vec![
            Call::Sha(FileType::Pptx),
            Call::CreateInstance("upgraded-sha".to_string()),
            // The type changes before the copy, so the copy's object-created
            // event sees pptx and requests nothing.
            Call::Swap(FileType::Ppt, FileType::Pptx),
            Call::Promote(
                FileType::Pptx,
                UpgradedObjectDestination::DocumentVersion { version_id: 42 }
            ),
            Call::SetContent(
                DocumentContentState::Ready,
                Some(DocumentContentLocation::ObjectStorage)
            ),
        ]
    );
}

#[tokio::test]
async fn applies_workbook_upgrade_as_new_version() {
    let fake = Fake::with_type(FileType::Xls);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let outcome = upgrader
        .apply_upgrade(&document(Some("xls")), FileType::Xlsx)
        .await
        .unwrap();

    assert_eq!(outcome, UpgradeOutcome::Applied);
    assert_eq!(fake.stored_type(), Some(FileType::Xlsx));
    assert!(fake.calls().contains(&Call::Promote(
        FileType::Xlsx,
        UpgradedObjectDestination::DocumentVersion { version_id: 42 }
    )));
}

#[tokio::test]
async fn applies_word_upgrade_through_the_docx_pipeline() {
    let fake = Fake::with_type(FileType::Doc);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let outcome = upgrader
        .apply_upgrade(&document(Some("doc")), FileType::Docx)
        .await
        .unwrap();

    assert_eq!(outcome, UpgradeOutcome::Applied);
    assert_eq!(fake.stored_type(), Some(FileType::Docx));
    assert_eq!(
        fake.calls(),
        vec![
            Call::CreateBom,
            Call::Swap(FileType::Doc, FileType::Docx),
            Call::SetContent(
                DocumentContentState::Pending,
                Some(DocumentContentLocation::ConvertedPdf)
            ),
            Call::Promote(
                FileType::Docx,
                UpgradedObjectDestination::DocxStaging { bom_id: 7 }
            ),
        ]
    );
}

#[tokio::test]
async fn skips_when_already_upgraded() {
    for (stored, target) in [
        ("pptx", FileType::Pptx),
        ("docx", FileType::Docx),
        ("xlsx", FileType::Xlsx),
    ] {
        let fake = Fake::default();
        let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

        let outcome = upgrader
            .apply_upgrade(&document(Some(stored)), target)
            .await
            .unwrap();

        assert_eq!(outcome, UpgradeOutcome::Skipped, "{stored}");
        assert!(fake.calls().is_empty(), "{stored}");
    }
}

#[tokio::test]
async fn skips_when_the_upgrade_is_for_a_different_legacy_type() {
    let fake = Fake::with_type(FileType::Doc);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let outcome = upgrader
        .apply_upgrade(&document(Some("doc")), FileType::Pptx)
        .await
        .unwrap();

    assert_eq!(outcome, UpgradeOutcome::Skipped);
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn rejects_non_upgrade_targets() {
    let fake = Fake::with_type(FileType::Pdf);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let error = upgrader
        .apply_upgrade(&document(Some("pdf")), FileType::Pdf)
        .await
        .unwrap_err();

    assert!(matches!(error, DocumentError::BadRequest(_)));
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn concurrent_apply_that_loses_the_swap_cleans_up() {
    // Another delivery already swapped the type after this one read it.
    let fake = Fake::with_type(FileType::Pptx);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let outcome = upgrader
        .apply_upgrade(&document(Some("ppt")), FileType::Pptx)
        .await
        .unwrap();

    assert_eq!(outcome, UpgradeOutcome::Skipped);
    assert_eq!(
        fake.calls(),
        vec![
            Call::Sha(FileType::Pptx),
            Call::CreateInstance("upgraded-sha".to_string()),
            Call::Swap(FileType::Ppt, FileType::Pptx),
            Call::DeleteInstance(42),
        ]
    );
}

#[tokio::test]
async fn concurrent_docx_apply_that_loses_the_swap_cleans_up() {
    let fake = Fake::with_type(FileType::Docx);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let outcome = upgrader
        .apply_upgrade(&document(Some("doc")), FileType::Docx)
        .await
        .unwrap();

    assert_eq!(outcome, UpgradeOutcome::Skipped);
    assert_eq!(
        fake.calls(),
        vec![
            Call::CreateBom,
            Call::Swap(FileType::Doc, FileType::Docx),
            Call::DeleteBom(7)
        ]
    );
}

#[tokio::test]
async fn failed_copy_restores_the_legacy_document() {
    let fake = Fake {
        fail_promote: true,
        ..Fake::with_type(FileType::Xls)
    };
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let result = upgrader
        .apply_upgrade(&document(Some("xls")), FileType::Xlsx)
        .await;

    assert!(result.is_err());
    assert_eq!(fake.stored_type(), Some(FileType::Xls));
    assert_eq!(
        fake.calls()[3..],
        [
            Call::Promote(
                FileType::Xlsx,
                UpgradedObjectDestination::DocumentVersion { version_id: 42 }
            ),
            Call::Swap(FileType::Xlsx, FileType::Xls),
            Call::DeleteInstance(42),
        ]
    );
}

#[tokio::test]
async fn failed_docx_staging_restores_the_legacy_document() {
    let fake = Fake {
        fail_promote: true,
        ..Fake::with_type(FileType::Doc)
    };
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let result = upgrader
        .apply_upgrade(&document(Some("doc")), FileType::Docx)
        .await;

    assert!(result.is_err());
    assert_eq!(fake.stored_type(), Some(FileType::Doc));
    assert_eq!(
        fake.calls()[3..],
        [
            Call::Promote(
                FileType::Docx,
                UpgradedObjectDestination::DocxStaging { bom_id: 7 }
            ),
            Call::Swap(FileType::Docx, FileType::Doc),
            Call::DeleteBom(7),
            Call::SetContent(
                DocumentContentState::Ready,
                Some(DocumentContentLocation::ObjectStorage)
            ),
        ]
    );
}

#[tokio::test]
async fn unreadable_upgrade_writes_nothing() {
    let fake = Fake {
        fail_sha: true,
        ..Fake::with_type(FileType::Ppt)
    };
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let result = upgrader
        .apply_upgrade(&document(Some("ppt")), FileType::Pptx)
        .await;

    assert!(result.is_err());
    assert_eq!(fake.calls(), vec![Call::Sha(FileType::Pptx)]);
    assert_eq!(fake.stored_type(), Some(FileType::Ppt));
}

#[tokio::test]
async fn applying_twice_applies_once() {
    let fake = Fake::with_type(FileType::Ppt);
    let upgrader = LegacyOfficeUpgrader::new(&fake, &fake);

    let first = upgrader
        .apply_upgrade(&document(Some("ppt")), FileType::Pptx)
        .await
        .unwrap();
    // A redelivered event reloads the document, which is now a pptx.
    let second = upgrader
        .apply_upgrade(&document(Some("pptx")), FileType::Pptx)
        .await
        .unwrap();

    assert_eq!(
        (first, second),
        (UpgradeOutcome::Applied, UpgradeOutcome::Skipped)
    );
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|call| matches!(call, Call::CreateInstance(_)))
            .count(),
        1
    );
}
