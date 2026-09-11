use super::*;
use std::sync::{Arc, Mutex};

struct Repo {
    access: Option<AccessLevel>,
    grants: Arc<Mutex<Vec<(Uuid, String, AccessLevel)>>>,
}

impl ReferenceShareRepository for Repo {
    async fn access(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &ReferencedShareItem,
    ) -> anyhow::Result<Option<AccessLevel>> {
        Ok(self.access)
    }
    async fn grant(
        &self,
        channel: Uuid,
        item: &ReferencedShareItem,
        level: AccessLevel,
    ) -> anyhow::Result<()> {
        self.grants
            .lock()
            .unwrap()
            .push((channel, item.entity_id().to_owned(), level));
        Ok(())
    }
}

#[tokio::test]
async fn only_owner_can_share_session_control_with_channel() {
    for access in [
        None,
        Some(AccessLevel::View),
        Some(AccessLevel::Comment),
        Some(AccessLevel::Edit),
        Some(AccessLevel::Owner),
    ] {
        let grants = Arc::new(Mutex::new(Vec::new()));
        let service = ReferenceShareService::from_repository(Repo {
            access,
            grants: grants.clone(),
        });
        let channel = Uuid::now_v7();
        let session = Uuid::now_v7().to_string();
        service
            .update_channel_share_permissions_for_referenced_items(
                MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
                channel,
                vec![ReferencedShareItem::from_raw(session.clone(), "agent_session").unwrap()],
            )
            .await
            .unwrap();
        let expected = if access == Some(AccessLevel::Owner) {
            vec![(channel, session, AccessLevel::Edit)]
        } else {
            vec![]
        };
        assert_eq!(*grants.lock().unwrap(), expected);
    }
}

#[test]
fn existing_reference_types_keep_view_sharing() {
    for kind in [
        ReferencedShareItemType::Document,
        ReferencedShareItemType::Chat,
        ReferencedShareItemType::Project,
        ReferencedShareItemType::EmailThread,
        ReferencedShareItemType::Call,
    ] {
        assert_eq!(grant_level(kind, None), None);
        assert_eq!(
            grant_level(kind, Some(AccessLevel::View)),
            Some(AccessLevel::View)
        );
        assert_eq!(
            grant_level(kind, Some(AccessLevel::Owner)),
            Some(AccessLevel::View)
        );
    }
}
