use super::*;
use crate::domain::permission_token::decode_permission_token;
use crate::domain::ports::editing::MockEditingWorkerService;
use entity_access::domain::models::{Entity, EntityPermission, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const SECRET: &str = "document-markdown-secret";

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

fn entity() -> Entity {
    Entity {
        entity_id: DOCUMENT.into(),
        entity_type: EntityType::Document,
    }
}

fn view_receipt() -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        entity(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

fn edit_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        entity(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn read_returns_the_body_with_a_view_token_for_the_caller() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_read_markdown()
        .times(1)
        .returning(|document_id, token| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(claims.access_level, AccessLevel::View);
            Box::pin(async {
                Ok(DocumentMarkdown {
                    markdown: "# Plan\n\nShip the beta.".to_string(),
                    revision: "AQID".to_string(),
                })
            })
        });

    let read = read_markdown(&worker, SECRET, view_receipt(), &document("md"))
        .await
        .unwrap();

    assert_eq!(
        read,
        DocumentMarkdown {
            markdown: "# Plan\n\nShip the beta.".to_string(),
            revision: "AQID".to_string(),
        }
    );
}

#[tokio::test]
async fn write_sends_the_expected_revision_with_an_edit_token() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_write_markdown().times(1).returning(
        |document_id, token, expected_revision, markdown| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(claims.access_level, AccessLevel::Edit);
            assert_eq!(expected_revision, "AQID");
            assert_eq!(markdown, "# Plan\n\nShip the beta on Friday.");
            Box::pin(async {
                Ok(MarkdownWrite::Written(DocumentMarkdownWritten {
                    revision: "AQIE".to_string(),
                    changed: true,
                }))
            })
        },
    );

    let written = write_markdown(
        &worker,
        SECRET,
        edit_receipt(),
        &document("md"),
        "AQID",
        "# Plan\n\nShip the beta on Friday.",
    )
    .await
    .unwrap();

    assert_eq!(
        written,
        DocumentMarkdownWritten {
            revision: "AQIE".to_string(),
            changed: true,
        }
    );
}

#[tokio::test]
async fn write_reports_a_document_changed_since_the_read_as_a_conflict() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_write_markdown()
        .times(1)
        .returning(|_, _, _, _| Box::pin(async { Ok(MarkdownWrite::Conflict) }));

    let conflict = write_markdown(
        &worker,
        SECRET,
        edit_receipt(),
        &document("md"),
        "AQID",
        "Ship the release.",
    )
    .await;

    assert!(matches!(conflict, Err(DocumentMarkdownError::Conflict)));
}

#[tokio::test]
async fn documents_that_are_not_markdown_and_empty_revisions_never_reach_the_worker() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_read_markdown().never();
    worker.expect_write_markdown().never();

    let not_markdown_read = read_markdown(&worker, SECRET, view_receipt(), &document("docx")).await;
    let not_markdown_write = write_markdown(
        &worker,
        SECRET,
        edit_receipt(),
        &document("docx"),
        "AQID",
        "Ship it.",
    )
    .await;
    let empty_revision = write_markdown(
        &worker,
        SECRET,
        edit_receipt(),
        &document("md"),
        "",
        "Ship it.",
    )
    .await;

    assert!(matches!(
        not_markdown_read,
        Err(DocumentMarkdownError::Document(DocumentError::BadRequest(
            _
        )))
    ));
    assert!(matches!(
        not_markdown_write,
        Err(DocumentMarkdownError::Document(DocumentError::BadRequest(
            _
        )))
    ));
    assert!(matches!(
        empty_revision,
        Err(DocumentMarkdownError::Document(DocumentError::BadRequest(
            _
        )))
    ));
}

#[tokio::test]
async fn audit_skill_instructions_are_not_rewritten_by_mentions_or_no_send_runs() {
    use agent_correlation::context::{Attribution, scope_attribution};
    use agent_correlation::scope::SessionScope;
    for (skill, mention, no_send, allowed) in [
        (true, false, false, true),
        (true, true, false, false),
        (true, true, true, false),
        (true, false, true, false),
        (false, true, true, true),
    ] {
        let mut metadata = document("md");
        if skill {
            metadata.sub_type = Some(document_sub_type::DocumentSubType::Skill);
        }
        let attribution = Attribution {
            correlation_id: Some(uuid::Uuid::from_u128(701)),
            session_id: Some(uuid::Uuid::from_u128(702)),
            channel_mention_id: mention.then_some(uuid::Uuid::from_u128(703)),
            scope: no_send.then_some(SessionScope::NoSend),
            ..Default::default()
        };
        let writes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let called = writes.clone();
        let mut worker = MockEditingWorkerService::new();
        worker
            .expect_write_markdown()
            .times(0..=1)
            .returning(move |_, _, _, _| {
                called.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Box::pin(async {
                    Ok(MarkdownWrite::Written(DocumentMarkdownWritten {
                        revision: "AQIE".into(),
                        changed: true,
                    }))
                })
            });
        let result = scope_attribution(
            attribution,
            write_markdown(
                &worker,
                SECRET,
                edit_receipt(),
                &metadata,
                "AQID",
                "# Updated instructions",
            ),
        )
        .await;
        if allowed {
            assert!(
                result.is_ok(),
                "skill={skill} mention={mention} no_send={no_send}: {result:?}"
            );
            assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 1);
        } else {
            assert!(
                matches!(
                    result,
                    Err(DocumentMarkdownError::Document(DocumentError::Forbidden(_)))
                ),
                "skill={skill} mention={mention} no_send={no_send}: {result:?}"
            );
            assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 0);
        }
    }
}
