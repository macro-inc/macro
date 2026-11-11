use super::*;
use crate::domain::{
    ports::editing::MockEditingWorkerService, spreadsheet::MockSpreadsheetDocumentLookup,
};
use ai_billing::domain::admission::AdmissionFuture;
use ai_usage::UsageEvent;
use entity_access::domain::models::{Entity, EntityPermission, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const SECRET: &str = "local-spreadsheet-test-secret";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|sheets@macro.com".to_owned()).unwrap()
}

fn receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn spreadsheet() -> MockSpreadsheetDocumentLookup {
    let mut lookup = MockSpreadsheetDocumentLookup::new();
    lookup
        .expect_file_type()
        .returning(|_| Box::pin(async { Ok(Some("spreadsheet".to_owned())) }));
    lookup
}

struct Admission(Result<(), AiAdmissionError>);
impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        caller: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            assert_eq!(caller.as_ref(), "macro|sheets@macro.com");
            assert_eq!(feature, AiFeature::AiEditing);
            self.0
        })
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);
impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[tokio::test]
async fn an_edit_mints_edit_access_and_bills_the_writer() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_spreadsheet_instructions()
        .times(1)
        .returning(|_, token, instructions| {
            let claims: serde_json::Value =
                macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
            assert_eq!(claims["access_level"], "edit");
            assert_eq!(claims["user_id"], "macro|sheets@macro.com");
            assert_eq!(instructions, "Add a total row.");
            Box::pin(async {
                Ok(SpreadsheetWriterResult {
                    outcome: serde_json::from_value(serde_json::json!({
                        "outcome": "edited", "revision": "r2", "applied": true,
                        "changes": [{"type": "set_cells", "sheetId": "sheet1", "summary": "Set 2 cell(s) in “Sheet1”.", "range": "A4:B4"}],
                        "sheets": [], "warnings": []
                    }))
                    .unwrap(),
                    usage: vec![EditUsage {
                        model: "claude-sonnet-5-5".into(),
                        input_tokens: 900,
                        output_tokens: 120,
                    }],
                })
            })
        });
    let recorder = Arc::new(Recorder::default());
    let service = SpreadsheetAiEditService::new(
        Arc::new(spreadsheet()),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Ok(()))),
        recorder.clone(),
    );

    let edited = service.edit(receipt(), "Add a total row.").await.unwrap();

    assert_eq!(edited.revision, "r2");
    assert_eq!(edited.changes[0].range.as_deref(), Some("A4:B4"));
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 900,
            output: 120,
            cache_read: 0,
            cache_write: 0
        }
    );
}

#[tokio::test]
async fn a_refusal_is_billed_and_saves_nothing() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_spreadsheet_instructions()
        .times(1)
        .returning(|_, _, _| {
            Box::pin(async {
                Ok(SpreadsheetWriterResult {
                    outcome: SpreadsheetWriterOutcome::Refused {
                        reason: "There is no Revenue sheet.".into(),
                    },
                    usage: vec![EditUsage {
                        model: "claude-sonnet-5-5".into(),
                        input_tokens: 400,
                        output_tokens: 30,
                    }],
                })
            })
        });
    let recorder = Arc::new(Recorder::default());
    let service = SpreadsheetAiEditService::new(
        Arc::new(spreadsheet()),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Ok(()))),
        recorder.clone(),
    );

    let error = service
        .edit(receipt(), "Total the Revenue sheet.")
        .await
        .unwrap_err();

    assert!(
        matches!(error, SpreadsheetAiEditError::Refused(reason) if reason == "There is no Revenue sheet.")
    );
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_change_during_the_edit_is_a_revision_conflict() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_spreadsheet_instructions()
        .times(1)
        .returning(|_, _, _| {
            Box::pin(async {
                Ok(SpreadsheetWriterResult {
                    outcome: SpreadsheetWriterOutcome::Failed {
                        error: "The spreadsheet changed since it was read.".into(),
                        conflict: true,
                        may_have_saved: false,
                    },
                    usage: vec![],
                })
            })
        });
    let service = SpreadsheetAiEditService::new(
        Arc::new(spreadsheet()),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Ok(()))),
        Arc::new(Recorder::default()),
    );

    let error = service.edit(receipt(), "Add a sheet.").await.unwrap_err();

    assert!(matches!(
        error,
        SpreadsheetAiEditError::Spreadsheet(SpreadsheetError::RevisionConflict(_))
    ));
}

#[tokio::test]
async fn a_refused_admission_runs_no_model() {
    let service = SpreadsheetAiEditService::new(
        Arc::new(spreadsheet()),
        Arc::new(MockEditingWorkerService::new()),
        SECRET.into(),
        Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
        Arc::new(Recorder::default()),
    );

    let error = service.edit(receipt(), "Add a sheet.").await.unwrap_err();

    assert!(matches!(error, SpreadsheetAiEditError::Admission(_)));
}
