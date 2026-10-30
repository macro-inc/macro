use super::*;
use crate::domain::models::ImportEntity;
use crate::domain::ports::Result;
use crate::domain::service::{DiscardOutcome, ImportStager, StageOutcome};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|tester@macro.com".to_string()).expect("valid test user id")
}

fn row(source: ImportSource, status: ImportStatus) -> ImportEntity {
    ImportEntity {
        id: Uuid::nil(),
        user_id: user().as_ref().to_string(),
        team_id: None,
        source,
        kind: source.default_kind(),
        foreign_id: "ENG-1".into(),
        parent_id: None,
        review_id: None,
        status,
        initiator: Initiator::Chat,
        metadata: serde_json::json!({"title": "T"}),
        entity_id: matches!(status, ImportStatus::Imported).then(|| "doc-1".to_string()),
        entity_type: matches!(status, ImportStatus::Imported)
            .then(|| source.entity_type().to_string()),
        last_error: None,
        waiting_on: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

/// Stager that returns canned outcomes and records what reached it.
#[derive(Default)]
struct MockStager {
    staged_calls: Mutex<Vec<(Initiator, ImportSource, String)>>,
    notion_import_calls: Mutex<Vec<String>>,
    stage_outcome: Option<StageOutcome>,
}

impl ImportStager for MockStager {
    async fn stage(
        &self,
        _user: &MacroUserIdStr<'static>,
        initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        _metadata: serde_json::Value,
    ) -> Result<StageOutcome> {
        self.staged_calls
            .lock()
            .unwrap()
            .push((initiator, source, foreign_id.to_string()));
        Ok(self
            .stage_outcome
            .clone()
            .unwrap_or(StageOutcome::Staged(row(source, ImportStatus::Staged))))
    }

    async fn record_imported(
        &self,
        _user: &MacroUserIdStr<'static>,
        _initiator: Initiator,
        source: ImportSource,
        _foreign_id: &str,
        _metadata: serde_json::Value,
        _entity_id: &str,
    ) -> Result<ImportEntity> {
        Ok(row(source, ImportStatus::Imported))
    }

    async fn discard_entity(
        &self,
        _user: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<DiscardOutcome> {
        Ok(DiscardOutcome::NotDiscardable(ImportStatus::Imported))
    }

    async fn list_entities(
        &self,
        _user: &MacroUserIdStr<'static>,
        _source: Option<ImportSource>,
        _status: Option<ImportStatus>,
    ) -> Result<Vec<ImportEntity>> {
        Ok(vec![row(ImportSource::Linear, ImportStatus::Imported)])
    }
}

impl NotionPageImporter for MockStager {
    async fn import_notion_page(
        &self,
        _user: &MacroUserIdStr<'static>,
        page_url_or_id: &str,
    ) -> Result<ImportNotionPageOutcome> {
        self.notion_import_calls
            .lock()
            .unwrap()
            .push(page_url_or_id.to_string());
        Ok(ImportNotionPageOutcome::Imported {
            entity: row(ImportSource::Notion, ImportStatus::Imported),
            already_existed: false,
            by_teammate: false,
        })
    }
}

fn contexts() -> (
    ServiceContext<ImportToolContext<MockStager>>,
    RequestContext,
    Arc<MockStager>,
) {
    let stager = Arc::new(MockStager::default());
    let context = ImportToolContext::wired(stager.clone());
    (ServiceContext(context), RequestContext::new(user()), stager)
}

#[tokio::test]
async fn staging_records_the_chat_initiator() {
    let (service_context, request_context, stager) = contexts();

    let response = CreateImportEntity {
        source: ImportSource::Linear,
        foreign_id: "ENG-1".into(),
        status: CreateImportStatus::Staged,
        metadata: serde_json::json!({"title": "T"}),
        entity_id: None,
    }
    .call(service_context, request_context)
    .await
    .expect("staging succeeds");

    assert_eq!(response.outcome, "staged");
    assert_eq!(
        stager.staged_calls.lock().unwrap().as_slice(),
        &[(Initiator::Chat, ImportSource::Linear, "ENG-1".to_string())]
    );
}

#[tokio::test]
async fn imported_writes_require_an_entity_id() {
    let (service_context, request_context, _) = contexts();
    let err = CreateImportEntity {
        source: ImportSource::Linear,
        foreign_id: "ENG-1".into(),
        status: CreateImportStatus::Imported,
        metadata: serde_json::json!({"title": "T"}),
        entity_id: Some("  ".into()),
    }
    .call(service_context, request_context)
    .await
    .expect_err("imported without entity id must fail");
    assert!(err.description.contains("entityId is required"), "{err:?}");
}

#[tokio::test]
async fn teammate_dedup_response_tells_the_agent_not_to_duplicate() {
    let teammate_row = ImportEntity {
        user_id: "macro|teammate@macro.com".into(),
        ..row(ImportSource::Linear, ImportStatus::Imported)
    };
    let stager = Arc::new(MockStager {
        stage_outcome: Some(StageOutcome::AlreadyImported {
            entity: teammate_row,
            by_teammate: true,
        }),
        ..Default::default()
    });
    let context = ImportToolContext::wired(stager);
    let response = CreateImportEntity {
        source: ImportSource::Linear,
        foreign_id: "ENG-1".into(),
        status: CreateImportStatus::Staged,
        metadata: serde_json::json!({"title": "T"}),
        entity_id: None,
    }
    .call(ServiceContext(context), RequestContext::new(user()))
    .await
    .expect("dedup is a successful outcome, not an error");
    assert_eq!(response.outcome, "already_imported_by_teammate");
    assert!(response.message.contains("Do NOT create a duplicate"));
    assert!(response.entity.imported_by_teammate);
}

#[tokio::test]
async fn import_notion_page_runs_the_workflow_and_returns_the_document() {
    let (service_context, request_context, stager) = contexts();
    let page_url = "https://app.notion.com/p/4d005e63b2fd4d079df4e376e35b7519";

    let response = ImportNotionPage {
        page_url: format!("  {page_url}  "),
    }
    .call(service_context, request_context)
    .await
    .expect("Notion import succeeds");

    assert_eq!(response.outcome, "imported");
    assert_eq!(response.entity.entity_id.as_deref(), Some("doc-1"));
    assert_eq!(response.entity.entity_type.as_deref(), Some("md"));
    assert_eq!(
        stager.notion_import_calls.lock().unwrap().as_slice(),
        &[page_url.to_string()]
    );
}

#[tokio::test]
async fn import_notion_page_requires_a_page_url() {
    let (service_context, request_context, stager) = contexts();

    let error = ImportNotionPage {
        page_url: "  ".to_string(),
    }
    .call(service_context, request_context)
    .await
    .expect_err("empty page URL must fail");

    assert!(error.description.contains("required"), "{error:?}");
    assert!(stager.notion_import_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_reports_non_discardable_status() {
    let (service_context, request_context, _) = contexts();
    let err = DeleteImportEntity { id: Uuid::nil() }
        .call(service_context, request_context)
        .await
        .expect_err("non-staged rows cannot be declined");
    assert!(err.description.contains("only staged items"), "{err:?}");
}
