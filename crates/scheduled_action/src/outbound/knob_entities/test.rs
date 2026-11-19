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

/// Items in the trash, or no longer of their kind, by id.
struct Trash(Vec<&'static str>);

impl LiveItems for Trash {
    async fn live(&self, item: &EntityValue) -> Result<bool, Report> {
        if item.id.as_str() == "trash-broken" {
            return Err(rootcause::report!("database unavailable"));
        }
        Ok(!self.0.contains(&item.id.as_str()))
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
            granted: vec![
                "c1",
                "d1",
                "p1",
                "db1",
                "t1",
                "e1",
                "a1",
                "co1",
                "ct1",
                "i1",
                "trashed",
                "trash-broken",
            ],
            calls: Arc::clone(&calls),
        },
        People,
        Trash(vec!["trashed"]),
    );
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    for (kind, id, usable) in [
        ("channel", "c1", true),
        ("channel", "c2", false),
        ("document", "d1", true),
        ("project", "p1", true),
        ("database", "db1", true),
        ("database", "gone", false),
        ("task", "t1", true),
        ("email_thread", "e1", true),
        ("chat", "a1", true),
        ("crm_company", "co1", true),
        ("crm_contact", "ct1", true),
        ("initiative", "i1", true),
        ("initiative", "gone", false),
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
        calls.lock().unwrap()[..13],
        [
            ("c1".to_owned(), EntityType::Channel),
            ("c2".to_owned(), EntityType::Channel),
            ("d1".to_owned(), EntityType::Document),
            ("p1".to_owned(), EntityType::Project),
            ("db1".to_owned(), EntityType::Database),
            ("gone".to_owned(), EntityType::Database),
            ("t1".to_owned(), EntityType::Document),
            ("e1".to_owned(), EntityType::EmailThread),
            ("a1".to_owned(), EntityType::Chat),
            ("co1".to_owned(), EntityType::CrmCompany),
            ("ct1".to_owned(), EntityType::CrmContact),
            ("i1".to_owned(), EntityType::Initiative),
            ("gone".to_owned(), EntityType::Initiative),
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

#[tokio::test]
async fn an_item_its_owner_trashed_is_not_usable_though_they_can_still_open_it() {
    let access = KnobEntityAccess::new(
        AccessService {
            granted: vec!["trashed", "trash-broken"],
            calls: Arc::default(),
        },
        People,
        Trash(vec!["trashed"]),
    );
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    for kind in ["document", "task", "project", "chat"] {
        assert!(
            !access.usable(&owner, &item(kind, "trashed")).await.unwrap(),
            "{kind}"
        );
        assert!(
            access
                .usable(&owner, &item(kind, "trash-broken"))
                .await
                .is_err(),
            "{kind}"
        );
    }
    // Kinds deleted outright never ask the trash.
    for kind in [
        "channel",
        "database",
        "email_thread",
        "crm_company",
        "crm_contact",
        "initiative",
    ] {
        assert!(
            access
                .usable(&owner, &item(kind, "trash-broken"))
                .await
                .unwrap(),
            "{kind}"
        );
    }
}
