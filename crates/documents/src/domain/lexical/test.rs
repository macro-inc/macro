use super::*;
use crate::domain::permission_token::decode_permission_token;
use crate::domain::ports::editing::{EditorName, MockEditingWorkerService};
use bot_id::MACRO_AI_BOT_ID;
use entity_access::domain::models::{
    BotReceiptScope, Entity, EntityAccessAuth, EntityPermission, EntityType,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const OTHER_DOCUMENT: &str = "019fd3b9-0000-7000-8000-000000000000";
const SECRET: &str = "document-lexical-secret";

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

fn view_receipt(document_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: document_id.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
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

fn paragraph_commit() -> DocumentLexicalCommitRequest {
    DocumentLexicalCommitRequest {
        revision: "AQID".to_string(),
        blocks: vec![DocumentLexicalBlock {
            id: "k3Fq".to_string(),
            after: None,
            node: serde_json::json!({
                "type": "paragraph",
                "version": 1,
                "$": { "id": "k3Fq" },
                "children": [{ "type": "text", "version": 1, "text": "Q4 plan" }],
            }),
        }],
        removed: vec!["p9Zx".to_string()],
    }
}

#[tokio::test]
async fn a_read_returns_the_workers_state_and_revision_with_a_view_token() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_lexical_state()
        .times(1)
        .returning(|document_id, token| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(claims.access_level, AccessLevel::View);
            assert_eq!(claims.actor, None);
            Box::pin(async {
                Ok(DocumentLexicalState {
                    state: serde_json::json!({ "root": { "type": "root", "children": [] } }),
                    revision: "AQID".to_string(),
                })
            })
        });

    let read = read_lexical(&worker, SECRET, view_receipt(DOCUMENT), &document("md"))
        .await
        .unwrap();

    assert_eq!(
        read,
        DocumentLexicalState {
            state: serde_json::json!({ "root": { "type": "root", "children": [] } }),
            revision: "AQID".to_string(),
        }
    );
}

#[tokio::test]
async fn a_read_refuses_other_file_types_and_receipts_for_another_document() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_lexical_state().never();

    let not_markdown = read_lexical(&worker, SECRET, view_receipt(DOCUMENT), &document("docx"))
        .await
        .unwrap_err();
    let other_document = read_lexical(
        &worker,
        SECRET,
        view_receipt(OTHER_DOCUMENT),
        &document("md"),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&not_markdown, DocumentError::BadRequest(message) if message == "document is not a markdown document"),
        "{not_markdown:?}"
    );
    assert!(
        matches!(other_document, DocumentError::Unauthorized),
        "{other_document:?}"
    );
}

#[tokio::test]
async fn a_read_without_a_user_or_bot_never_reaches_the_worker() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_lexical_state().never();
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::try_new(
        EntityAccessAuth::Unauthenticated,
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();

    let error = read_lexical(&worker, SECRET, receipt, &document("md"))
        .await
        .unwrap_err();

    assert!(matches!(error, DocumentError::Unauthorized), "{error:?}");
}

#[tokio::test]
async fn a_commit_sends_the_blocks_with_an_edit_token_and_returns_the_merged_state() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_lexical_commit()
        .times(1)
        .returning(|document_id, token, commit, editor| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(claims.access_level, AccessLevel::Edit);
            assert_eq!(commit, &paragraph_commit());
            assert_eq!(editor, None);
            Box::pin(async {
                Ok(LexicalCommitOutcome::Committed(DocumentLexicalCommitted {
                    revision: "BAUG".to_string(),
                    state: serde_json::json!({ "root": { "type": "root", "children": [] } }),
                }))
            })
        });

    let committed = commit_lexical(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &paragraph_commit(),
    )
    .await
    .unwrap();

    assert_eq!(
        committed,
        DocumentLexicalCommitted {
            revision: "BAUG".to_string(),
            state: serde_json::json!({ "root": { "type": "root", "children": [] } }),
        }
    );
}

#[tokio::test]
async fn a_bot_commit_carries_the_user_and_bot_in_the_token_and_the_bot_name_on_the_cursor() {
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
        .expect_lexical_commit()
        .times(1)
        .returning(|_, token, _, editor| {
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(
                claims.actor,
                Some("bot|00000000-0000-0000-0000-00000000a1a1".to_string())
            );
            assert_eq!(claims.access_level, AccessLevel::Edit);
            assert_eq!(editor, EditorName::new("Macro"));
            Box::pin(async {
                Ok(LexicalCommitOutcome::Committed(DocumentLexicalCommitted {
                    revision: "BAUG".to_string(),
                    state: serde_json::json!({ "root": { "type": "root", "children": [] } }),
                }))
            })
        });

    let committed = commit_lexical(
        &worker,
        SECRET,
        receipt,
        &document("md"),
        &paragraph_commit(),
    )
    .await
    .unwrap();

    assert_eq!(committed.revision, "BAUG");
}

#[tokio::test]
async fn a_commit_refuses_other_file_types_other_documents_and_anonymous_callers() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_lexical_commit().never();
    let anonymous = EntityAccessReceipt::<EditAccessLevel>::try_new(
        EntityAccessAuth::Unauthenticated,
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap();

    let not_markdown = commit_lexical(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("docx"),
        &paragraph_commit(),
    )
    .await
    .unwrap_err();
    let other_document = commit_lexical(
        &worker,
        SECRET,
        edit_receipt(OTHER_DOCUMENT),
        &document("md"),
        &paragraph_commit(),
    )
    .await
    .unwrap_err();
    let no_caller = commit_lexical(
        &worker,
        SECRET,
        anonymous,
        &document("md"),
        &paragraph_commit(),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&not_markdown, DocumentLexicalError::Document(DocumentError::BadRequest(message)) if message == "document is not a markdown document"),
        "{not_markdown:?}"
    );
    assert!(
        matches!(
            other_document,
            DocumentLexicalError::Document(DocumentError::Unauthorized)
        ),
        "{other_document:?}"
    );
    assert!(
        matches!(
            no_caller,
            DocumentLexicalError::Document(DocumentError::Unauthorized)
        ),
        "{no_caller:?}"
    );
}

#[tokio::test]
async fn a_commit_of_more_than_500_blocks_never_reaches_the_worker() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_lexical_commit().never();
    let commit = DocumentLexicalCommitRequest {
        revision: "AQID".to_string(),
        blocks: (0..501)
            .map(|index| DocumentLexicalBlock {
                id: format!("block{index}"),
                after: None,
                node: serde_json::json!({ "type": "paragraph", "$": { "id": format!("block{index}") } }),
            })
            .collect(),
        removed: Vec::new(),
    };

    let error = commit_lexical(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &commit,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentLexicalError::Document(DocumentError::BadRequest(message)) if message == "a commit carries at most 500 blocks, not 501"),
        "{error:?}"
    );
}

#[tokio::test]
async fn conflicts_invalid_commits_and_unknown_outcomes_pass_through() {
    let mut worker = MockEditingWorkerService::new();
    let mut outcomes = vec![
        LexicalCommitOutcome::Unacknowledged("sync service did not acknowledge".to_string()),
        LexicalCommitOutcome::Invalid("unknown node type: banner".to_string()),
        LexicalCommitOutcome::Conflict(vec![
            DocumentLexicalNodeConflict {
                id: Some("k3Fq".to_string()),
                reason: DocumentLexicalConflictReason::Changed,
            },
            DocumentLexicalNodeConflict {
                id: None,
                reason: DocumentLexicalConflictReason::Revision,
            },
        ]),
    ];
    worker
        .expect_lexical_commit()
        .times(3)
        .returning(move |_, _, _, _| {
            let outcome = outcomes.pop().unwrap();
            Box::pin(async move { Ok(outcome) })
        });

    let mut errors = Vec::new();
    for _ in 0..3 {
        errors.push(
            commit_lexical(
                &worker,
                SECRET,
                edit_receipt(DOCUMENT),
                &document("md"),
                &paragraph_commit(),
            )
            .await
            .unwrap_err(),
        );
    }

    assert!(
        matches!(&errors[0], DocumentLexicalError::Conflict(conflicts) if conflicts == &vec![
            DocumentLexicalNodeConflict {
                id: Some("k3Fq".to_string()),
                reason: DocumentLexicalConflictReason::Changed,
            },
            DocumentLexicalNodeConflict {
                id: None,
                reason: DocumentLexicalConflictReason::Revision,
            },
        ]),
        "{:?}",
        errors[0]
    );
    assert!(
        matches!(&errors[1], DocumentLexicalError::Invalid(message) if message == "unknown node type: banner"),
        "{:?}",
        errors[1]
    );
    assert!(
        matches!(&errors[2], DocumentLexicalError::OutcomeUnknown(message) if message == "sync service did not acknowledge"),
        "{:?}",
        errors[2]
    );
}

#[tokio::test]
async fn a_worker_failure_before_the_commit_is_an_internal_error() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_lexical_commit()
        .times(1)
        .returning(|_, _, _, _| {
            Box::pin(async {
                Err(anyhow::anyhow!(
                    "editing worker returned 403 Forbidden: token lacks edit access"
                ))
            })
        });

    let error = commit_lexical(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &paragraph_commit(),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentLexicalError::Document(DocumentError::Internal(error)) if error.to_string() == "editing worker returned 403 Forbidden: token lacks edit access"),
        "{error:?}"
    );
}
