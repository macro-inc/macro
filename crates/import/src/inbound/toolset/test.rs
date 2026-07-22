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
        foreign_id: "ENG-1".into(),
        status,
        initiator: Initiator::Onboarding,
        metadata: serde_json::json!({"title": "T"}),
        entity_id: matches!(status, ImportStatus::Imported).then(|| "doc-1".to_string()),
        entity_type: matches!(status, ImportStatus::Imported).then(|| "task".to_string()),
        last_error: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

/// Stager that returns canned outcomes and records what reached it.
#[derive(Default)]
struct MockStager {
    staged_calls: Mutex<Vec<(Initiator, ImportSource, String)>>,
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

fn contexts(
    policy: ToolPolicy,
) -> (
    ServiceContext<ImportToolContext<MockStager>>,
    RequestContext,
    Arc<MockStager>,
) {
    let stager = Arc::new(MockStager::default());
    let context = ImportToolContext {
        service: Some(stager.clone()),
        policy,
    };
    (ServiceContext(context), RequestContext::new(user()), stager)
}

#[tokio::test]
async fn gather_policy_locks_source_and_initiator() {
    let (service_context, request_context, stager) =
        contexts(ToolPolicy::gather(ImportSource::Linear));

    // Wrong source is refused before touching the service.
    let err = CreateImportEntity {
        source: ImportSource::Notion,
        foreign_id: "https://notion.so/x".into(),
        status: CreateImportStatus::Staged,
        metadata: serde_json::json!({"title": "T"}),
        entity_id: None,
    }
    .call(service_context.clone(), request_context.clone())
    .await
    .expect_err("forced source must reject other sources");
    assert!(err.description.contains("only stages linear"), "{err:?}");
    assert!(stager.staged_calls.lock().unwrap().is_empty());

    // status=imported is refused under a staging-only policy.
    let err = CreateImportEntity {
        source: ImportSource::Linear,
        foreign_id: "ENG-1".into(),
        status: CreateImportStatus::Imported,
        metadata: serde_json::json!({"title": "T"}),
        entity_id: Some("doc-1".into()),
    }
    .call(service_context.clone(), request_context.clone())
    .await
    .expect_err("staging-only policy must reject imported writes");
    assert!(err.description.contains("only stage"), "{err:?}");

    // The right source stages with the locked initiator.
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
        &[(
            Initiator::Onboarding,
            ImportSource::Linear,
            "ENG-1".to_string()
        )]
    );
}

#[tokio::test]
async fn chat_policy_requires_entity_id_for_imported_writes() {
    let (service_context, request_context, _) = contexts(ToolPolicy::chat());
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
    let context = ImportToolContext {
        service: Some(stager),
        policy: ToolPolicy::chat(),
    };
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
async fn delete_reports_non_discardable_status() {
    let (service_context, request_context, _) = contexts(ToolPolicy::chat());
    let err = DeleteImportEntity { id: Uuid::nil() }
        .call(service_context, request_context)
        .await
        .expect_err("non-staged rows cannot be declined");
    assert!(err.description.contains("only staged items"), "{err:?}");
}
