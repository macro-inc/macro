//! In-memory stand-ins for the service's ports, recording what was written.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{TimeZone, Utc};
use databases::domain::models::{DatabaseError, Viewer};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{CellWrite, DatabaseId, RowId, TableId};
use uuid::Uuid;

use crate::domain::mapping::WebhookColumn;
use crate::domain::models::{DatabaseWebhook, NewWebhook, WebhookId};
use crate::domain::ports::{CreatorAccess, DatabaseWebhooksRepo, WebhookTables};

/// Webhooks kept with their token hashes.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeRepo {
    pub(crate) stored: Arc<Mutex<Vec<NewWebhook>>>,
}

fn stored(webhook: &NewWebhook) -> DatabaseWebhook {
    DatabaseWebhook {
        id: webhook.id,
        database_id: webhook.database_id,
        table_id: webhook.table_id,
        created_by: webhook.created_by.clone(),
        token_prefix: webhook.token_prefix.clone(),
        created_at: Utc.with_ymd_and_hms(2026, 10, 9, 12, 0, 0).unwrap(),
    }
}

impl DatabaseWebhooksRepo for FakeRepo {
    async fn insert_webhook(
        &self,
        webhook: NewWebhook,
    ) -> Result<DatabaseWebhook, rootcause::Report> {
        let answer = stored(&webhook);
        self.stored.lock().unwrap().push(webhook);
        Ok(answer)
    }

    async fn database_webhooks(
        &self,
        database_id: DatabaseId,
    ) -> Result<Vec<DatabaseWebhook>, rootcause::Report> {
        Ok(self
            .stored
            .lock()
            .unwrap()
            .iter()
            .filter(|webhook| webhook.database_id == database_id)
            .map(stored)
            .collect())
    }

    async fn delete_webhook(
        &self,
        database_id: DatabaseId,
        webhook_id: WebhookId,
    ) -> Result<bool, rootcause::Report> {
        let mut webhooks = self.stored.lock().unwrap();
        let before = webhooks.len();
        webhooks
            .retain(|webhook| !(webhook.database_id == database_id && webhook.id == webhook_id));
        Ok(webhooks.len() != before)
    }

    async fn webhook_by_token_hash(
        &self,
        token_hash: [u8; 32],
    ) -> Result<Option<DatabaseWebhook>, rootcause::Report> {
        Ok(self
            .stored
            .lock()
            .unwrap()
            .iter()
            .find(|webhook| webhook.token_hash == token_hash)
            .map(stored))
    }
}

/// One insert the fake tables received.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Insert {
    pub(crate) database_id: String,
    pub(crate) viewer: String,
    pub(crate) table_id: TableId,
    pub(crate) rows: Vec<Vec<CellWrite>>,
}

/// Tables by database, and every insert they took.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeTables {
    pub(crate) tables: HashMap<(DatabaseId, TableId), Vec<WebhookColumn>>,
    pub(crate) inserts: Arc<Mutex<Vec<Insert>>>,
    /// What the databases service refuses the next insert with.
    pub(crate) refusal: Arc<Mutex<Option<DatabaseError>>>,
}

impl WebhookTables for FakeTables {
    async fn table_columns(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
    ) -> Result<Option<Vec<WebhookColumn>>, DatabaseError> {
        Ok(self.tables.get(&(database_id, table_id)).cloned())
    }

    async fn insert_rows(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        table_id: TableId,
        rows: Vec<Vec<CellWrite>>,
    ) -> Result<Vec<RowId>, DatabaseError> {
        if let Some(refusal) = self.refusal.lock().unwrap().take() {
            return Err(refusal);
        }
        let ids = (0..rows.len())
            .map(|index| RowId::from_uuid(Uuid::from_u128(1000 + index as u128)))
            .collect();
        self.inserts.lock().unwrap().push(Insert {
            database_id: receipt.entity().entity_id.clone(),
            viewer: viewer.user_id.to_string(),
            table_id,
            rows,
        });
        Ok(ids)
    }
}

/// Who can edit which database.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeAccess {
    pub(crate) editors: Arc<Mutex<Vec<(String, DatabaseId)>>>,
}

impl CreatorAccess for FakeAccess {
    async fn edit_receipt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
    ) -> Result<Option<EntityAccessReceipt<EditAccessLevel>>, rootcause::Report> {
        let can_edit = self
            .editors
            .lock()
            .unwrap()
            .contains(&(user_id.to_string(), database_id));
        Ok(can_edit.then(|| {
            EntityAccessReceipt::dangerously_assert_authenticated_user(
                user_id.clone(),
                &database_id.to_string(),
                EntityType::Database,
            )
        }))
    }
}
