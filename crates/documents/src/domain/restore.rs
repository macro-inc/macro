//! Restoration admission before the existing persistence operation is started.
use super::models::DocumentError;
use entity_access::domain::models::{EntityAccessReceipt, EntityType};
use model::document::DocumentBasic;
use models_permissions::share_permission::access_level::OwnerAccessLevel;

/// Run the existing restoration transaction only for the receipt's document.
/// The operation factory is lazy: admission happens before persistence starts.
pub async fn restore_document<Restore, Operation>(
    access: EntityAccessReceipt<OwnerAccessLevel>,
    document: &DocumentBasic,
    restore: Restore,
) -> Result<(), DocumentError>
where
    Restore: FnOnce(String, Option<String>) -> Operation + Send,
    Operation: Future<Output = anyhow::Result<()>> + Send,
{
    if access.entity().entity_type != EntityType::Document
        || access.entity().entity_id != document.document_id
    {
        return Err(DocumentError::Unauthorized);
    }
    restore(
        access.entity().entity_id.clone(),
        document.project_id.clone(),
    )
    .await
    .map_err(DocumentError::Internal)
}

#[cfg(test)]
mod test {
    use super::*;
    use agent_correlation::{
        context::{Attribution, scope_attribution},
        scope::SessionScope,
    };
    use model_owner::Owner;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    async fn restore_as_no_send(skill: bool) -> (Result<(), DocumentError>, usize) {
        let writes = Arc::new(AtomicUsize::new(0));
        let persisted = writes.clone();
        let receipt =
            EntityAccessReceipt::<OwnerAccessLevel>::dangerously_assert_authenticated_user(
                "macro|owner@example.com".to_owned().try_into().unwrap(),
                "document-fixture",
                EntityType::Document,
            );
        let document = DocumentBasic {
            document_id: "document-fixture".into(),
            document_name: "Deleted notes".into(),
            owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
            file_type: Some("md".into()),
            sub_type: skill.then_some(document_sub_type::DocumentSubType::Skill),
            project_id: Some("project-fixture".into()),
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            deleted_at: Some(chrono::DateTime::from_timestamp(1, 0).unwrap()),
        };
        let restored = scope_attribution(
            Attribution {
                scope: Some(SessionScope::NoSend),
                signed_scope: true,
                ..Attribution::default()
            },
            restore_document(receipt, &document, move |id, project| async move {
                assert_eq!(id, "document-fixture");
                assert_eq!(project.as_deref(), Some("project-fixture"));
                persisted.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }),
        )
        .await;
        (restored, writes.load(Ordering::SeqCst))
    }

    #[tokio::test]
    async fn no_send_never_revives_skill_instructions() {
        let (restored, writes) = restore_as_no_send(true).await;
        assert!(
            matches!(restored, Err(DocumentError::Forbidden(_))),
            "skill restoration must be refused before its write: {restored:?}"
        );
        assert_eq!(writes, 0);
    }

    #[tokio::test]
    async fn no_send_can_restore_an_ordinary_document() {
        let (restored, writes) = restore_as_no_send(false).await;
        assert!(restored.is_ok());
        assert_eq!(writes, 1);
    }
}
