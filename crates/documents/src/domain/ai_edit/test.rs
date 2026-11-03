use super::*;
use crate::domain::permission_token::decode_permission_token;
use crate::domain::ports::editing::{EditResult, MockEditingWorkerService};
use ai_billing::domain::DenyReason;
use ai_billing::domain::admission::{AdmissionFuture, AiAdmissionService};
use ai_usage::AiFeature;
use bot_id::MACRO_AI_BOT_ID;
use entity_access::domain::models::{BotReceiptScope, Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use std::sync::Arc;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const SECRET: &str = "document-ai-edit-secret";

fn document(file_type: &str) -> DocumentBasic {
    DocumentBasic {
        document_id: DOCUMENT.into(),
        document_name: "Notes".into(),
        owner: Owner::from_principal_str("macro|editor@example.com").unwrap(),
        file_type: Some(file_type.into()),
        sub_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

fn user() -> MacroUserIdStr<'static> {
    "macro|editor@example.com".to_owned().try_into().unwrap()
}

fn edit_receipt(document_id: &str) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: document_id.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

struct Refuse(AiAdmissionError);
impl AiAdmissionService for Refuse {
    fn admit<'a>(
        &'a self,
        caller: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            assert_eq!(caller.as_ref(), "macro|editor@example.com");
            assert_eq!(feature, AiFeature::AiEditing);
            Err(self.0)
        })
    }
}

fn ai_editing(
    worker: MockEditingWorkerService,
    admission: Arc<dyn AiAdmissionService>,
) -> AiEditingService<MockEditingWorkerService> {
    AiEditingService::new(
        Arc::new(worker),
        admission,
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
}

#[tokio::test]
async fn instructions_run_editdocuments_pipeline_and_return_the_revision() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_edit()
        .times(1)
        .returning(|document_id, token, instructions, mode, editor| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(claims.access_level, AccessLevel::Edit);
            assert_eq!(instructions, "Replace Q3 with Q4 in the plan");
            assert_eq!(mode, EditMode::Fast);
            assert_eq!(editor, None);
            Box::pin(async {
                Ok(EditResult {
                    edits_applied: 1,
                    usage: Vec::new(),
                    clarification: None,
                    revision: Some("AQID".to_string()),
                })
            })
        });

    let edited = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Replace Q3 with Q4 in the plan",
        true,
    )
    .await
    .unwrap();

    assert_eq!(
        edited,
        DocumentAiEdited {
            revision: "AQID".to_string(),
            clarification: None,
        }
    );
}

#[tokio::test]
async fn instructions_refuse_documents_that_are_not_markdown_and_empty_instructions() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().never();
    let editing = ai_editing(
        worker,
        Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
    );

    let not_markdown = edit_with_instructions(
        &editing,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("docx"),
        "Fix the heading",
        false,
    )
    .await
    .unwrap_err();
    let empty = edit_with_instructions(
        &editing,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "  ",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&not_markdown, DocumentAiEditError::Document(DocumentError::BadRequest(message)) if message == "document is not a markdown document"),
        "{not_markdown:?}"
    );
    assert!(
        matches!(&empty, DocumentAiEditError::Document(DocumentError::BadRequest(message)) if message == "instructions are empty"),
        "{empty:?}"
    );
}

#[tokio::test]
async fn instructions_refused_by_admission_never_reach_the_worker() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().never();

    let error = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(Refuse(AiAdmissionError::Denied(
                DenyReason::OveragePaymentFailed,
            ))),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Fix the heading",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(
            error,
            DocumentAiEditError::Admission(AiAdmissionError::Denied(
                DenyReason::OveragePaymentFailed
            ))
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_clarification_is_a_refused_edit() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().times(1).returning(|_, _, _, _, _| {
        Box::pin(async {
            Ok(EditResult {
                edits_applied: 0,
                usage: Vec::new(),
                clarification: Some("Which of the two plans?".to_string()),
                revision: None,
            })
        })
    });

    let error = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Fix the plan",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentAiEditError::Refused(reason) if reason == "Which of the two plans?"),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_clarification_after_applied_ops_keeps_what_changed() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().times(1).returning(|_, _, _, _, _| {
        Box::pin(async {
            Ok(EditResult {
                edits_applied: 2,
                usage: Vec::new(),
                clarification: Some("Which of the two plans?".to_string()),
                revision: Some("AQID".to_string()),
            })
        })
    });

    let edited = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Fix both plans",
        false,
    )
    .await
    .unwrap();

    assert_eq!(
        edited,
        DocumentAiEdited {
            revision: "AQID".to_string(),
            clarification: Some("Which of the two plans?".to_string()),
        }
    );
}

#[tokio::test]
async fn a_worker_failure_is_a_failed_edit_distinct_from_a_refusal() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().times(1).returning(|_, _, _, _, _| {
        Box::pin(async {
            Err(anyhow::anyhow!(
                "editing worker returned 502 Bad Gateway: sync service closed"
            ))
        })
    });

    let error = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Fix the plan",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentAiEditError::Failed(error) if error.to_string() == "editing worker returned 502 Bad Gateway: sync service closed"),
        "{error:?}"
    );
}

#[tokio::test]
async fn instructions_refuse_an_edit_receipt_for_another_document() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().never();

    let error = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt("019fd3b9-0000-7000-8000-000000000000"),
        &document("md"),
        "Fix the heading",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(
            error,
            DocumentAiEditError::Document(DocumentError::Unauthorized)
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn bot_instructions_carry_the_user_and_bot_in_the_token_and_the_bot_name_on_the_cursor() {
    let receipt = EntityAccessReceipt::<EditAccessLevel>::try_new_bot(
        MACRO_AI_BOT_ID.into_storage_id(),
        BotReceiptScope::User {
            acting_user: user(),
        },
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap();
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_edit()
        .times(1)
        .returning(|_, token, _, mode, editor| {
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(
                claims.actor,
                Some("bot|00000000-0000-0000-0000-00000000a1a1".to_string())
            );
            assert_eq!(mode, EditMode::Supervised);
            assert_eq!(editor, EditorName::new("Macro"));
            Box::pin(async {
                Ok(EditResult {
                    edits_applied: 1,
                    usage: Vec::new(),
                    clarification: None,
                    revision: Some("AQID".to_string()),
                })
            })
        });

    let edited = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        receipt,
        &document("md"),
        "Replace Q3 with Q4 in the plan",
        false,
    )
    .await
    .unwrap();

    assert_eq!(edited.revision, "AQID");
}
