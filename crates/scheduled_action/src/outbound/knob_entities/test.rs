use super::*;
use entity_access::domain::models::{
    AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity, EntityAccessReceipt,
    EntityPermission, RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use macro_uuid::Uuid;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct AccessService {
    /// Ids the owner may open; others are refused, and `broken` fails.
    granted: Vec<&'static str>,
    calls: Arc<Mutex<Vec<(String, EntityType)>>>,
}
impl EntityAccessService for AccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        org: Option<i64>,
        id: &str,
        kind: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        assert_eq!(org, None);
        assert_eq!(user.as_ref(), "macro|owner@macro.com");
        self.calls.lock().unwrap().push((id.into(), kind));
        if id == "broken" {
            return Err(AccessError::internal("database unavailable"));
        }
        if !self.granted.contains(&id) {
            return Err(AccessError::Unauthorized);
        }
        let permission = if kind == EntityType::Channel {
            EntityPermission::ChannelViewOnly
        } else {
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            }
        };
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::try_from(user.as_ref().to_string()).unwrap(),
            Entity {
                entity_id: id.into(),
                entity_type: kind,
            },
            permission,
        )
    }
    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _: BotId,
        _: BotAccessScope,
        _: &str,
        _: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unreachable!()
    }
    async fn get_access_level(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unreachable!()
    }
    async fn check_access(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn check_public_access(
        &self,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn get_entity_permission(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unreachable!()
    }
    async fn get_crm_entity_permission_with_team(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unreachable!()
    }
    async fn get_users_by_entity(
        &self,
        _: &str,
        _: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel(&self, _: &Uuid) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel_by_channel_id(
        &self,
        _: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
    async fn get_user_team(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unreachable!()
    }
}

struct People;

impl KnownPeople for People {
    async fn exists(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(user.as_ref() == "macro|dana@macro.com")
    }
}

fn item(kind: &str, id: &str) -> EntityValue {
    serde_json::from_value(json!({ "type": kind, "id": id })).unwrap()
}

#[tokio::test]
async fn an_item_is_usable_only_when_its_owner_can_open_it_as_its_kind() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let access = KnobEntityAccess::new(
        AccessService {
            granted: vec!["c1", "d1", "p1", "db1"],
            calls: Arc::clone(&calls),
        },
        People,
    );
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    for (kind, id, usable) in [
        ("channel", "c1", true),
        ("channel", "c2", false),
        ("document", "d1", true),
        ("project", "p1", true),
        ("database", "db1", true),
        ("database", "gone", false),
        ("user", "macro|dana@macro.com", true),
        ("user", "macro|nobody@macro.com", false),
        ("user", "dana@macro.com", false),
    ] {
        assert_eq!(
            access.usable(&owner, &item(kind, id)).await.unwrap(),
            usable,
            "{kind} {id}"
        );
    }
    assert_eq!(
        calls.lock().unwrap()[..5],
        [
            ("c1".to_owned(), EntityType::Channel),
            ("c2".to_owned(), EntityType::Channel),
            ("d1".to_owned(), EntityType::Document),
            ("p1".to_owned(), EntityType::Project),
            ("db1".to_owned(), EntityType::Database),
        ]
    );
    // An outage is never a refusal.
    assert!(
        access
            .usable(&owner, &item("document", "broken"))
            .await
            .is_err()
    );
}
