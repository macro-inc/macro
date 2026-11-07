use super::*;
use crate::{
    domain::models::{Notification, SendNotificationRequestBuilder, TaggedContent},
    outbound::repository::NotificationDbOps,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
struct PendingAccess;
impl Notification for PendingAccess {
    const TYPE_NAME: &'static str = "entity_access_requested";
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn withdrawal_prevents_delayed_notification_creation(pool: PgPool) {
    let id = Uuid::new_v4();
    let withdrawal = PgNotificationWithdrawal(pool.clone());
    withdrawal.withdraw(id).await.unwrap();
    withdrawal.withdraw(id).await.unwrap();
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("document"),
        secondary_notification_entity: None,
        sender_id: None,
        recipient_ids: HashSet::from([MacroUserIdStr::try_from("macro|owner@test.com").unwrap()]),
        notification: TaggedContent::new(PendingAccess),
    };
    assert!(
        pool.create_notification(request, id, "access_requests", None)
            .await
            .unwrap()
            .is_none()
    );
}
