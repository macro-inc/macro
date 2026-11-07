use std::sync::{Arc, Mutex};

use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, EditAccessLevel, EntityPermission, EntityType,
    ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use models_databases::DatabaseId;
use uuid::Uuid;

use super::ViewOnlyAccess;
use crate::test_support::{FakeAccess, OWNER, World, user};

const OFFSITE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdb01));

fn owner_access() -> ViewOnlyAccess<FakeAccess> {
    ViewOnlyAccess(FakeAccess(Arc::new(Mutex::new(World {
        grants: vec![(OWNER, OFFSITE, AccessLevel::Owner)],
        ..World::default()
    }))))
}

#[tokio::test]
async fn an_owner_gets_a_view_receipt_and_no_edit_receipt() {
    let access = owner_access();

    let view = access
        .generate_bot_entity_access_receipt::<ViewAccessLevel>(
            bot_id::MACRO_AI_BOT_ID,
            BotAccessScope::user(user(OWNER)),
            &OFFSITE.to_string(),
            EntityType::Database,
        )
        .await
        .expect("an owner can view");
    assert_eq!(
        *view.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View
        }
    );

    let edit = access
        .generate_bot_entity_access_receipt::<EditAccessLevel>(
            bot_id::MACRO_AI_BOT_ID,
            BotAccessScope::user(user(OWNER)),
            &OFFSITE.to_string(),
            EntityType::Database,
        )
        .await
        .expect_err("view-only access never edits");
    assert!(matches!(edit, AccessError::Unauthorized), "{edit:?}");

    let user_edit = access
        .generate_entity_access_receipt::<EditAccessLevel>(
            &user(OWNER),
            None,
            &OFFSITE.to_string(),
            EntityType::Database,
        )
        .await
        .expect_err("view-only access never edits");
    assert!(
        matches!(user_edit, AccessError::Unauthorized),
        "{user_edit:?}"
    );
}
