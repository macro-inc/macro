//! What the webhooks service needs, and what it offers.

use databases::domain::models::{DatabaseError, Viewer};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{CellWrite, DatabaseId, RowId, TableId};
use serde_json::Value;

use crate::domain::mapping::WebhookColumn;
use crate::domain::models::{
    CreatedWebhook, DatabaseWebhook, DatabaseWebhookError, Delivery, NewWebhook, WebhookId,
};

/// The webhooks domain service.
pub trait DatabaseWebhooksService: Send + Sync + 'static {
    /// Create a webhook that inserts rows into one of the receipt's
    /// database's tables, acting with the creator's access.
    fn create_webhook(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
    ) -> impl Future<Output = Result<CreatedWebhook, DatabaseWebhookError>> + Send;

    /// The receipt's database's webhooks, oldest first.
    fn list_webhooks(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<Vec<DatabaseWebhook>, DatabaseWebhookError>> + Send;

    /// Delete one of the receipt's database's webhooks; its URL stops
    /// working.
    fn delete_webhook(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<(), DatabaseWebhookError>> + Send;

    /// Insert the payload's rows through the webhook the token names. The
    /// token is the whole credential; the write acts as the webhook's
    /// creator, so it stops when they can no longer edit the database.
    fn deliver(
        &self,
        token: &str,
        payload: &Value,
    ) -> impl Future<Output = Result<Delivery, DatabaseWebhookError>> + Send;
}

/// Where webhooks are kept.
pub trait DatabaseWebhooksRepo: Send + Sync + 'static {
    /// Store a new webhook.
    fn insert_webhook(
        &self,
        webhook: NewWebhook,
    ) -> impl Future<Output = Result<DatabaseWebhook, rootcause::Report>> + Send;

    /// A database's webhooks, oldest first.
    fn database_webhooks(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Vec<DatabaseWebhook>, rootcause::Report>> + Send;

    /// Delete a webhook of the database; whether there was one.
    fn delete_webhook(
        &self,
        database_id: DatabaseId,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;

    /// The webhook whose token hashes to `token_hash`.
    fn webhook_by_token_hash(
        &self,
        token_hash: [u8; 32],
    ) -> impl Future<Output = Result<Option<DatabaseWebhook>, rootcause::Report>> + Send;
}

/// The tables webhooks write, through the databases service.
pub trait WebhookTables: Send + Sync + 'static {
    /// The table's columns, in display order; `None` when the database is
    /// gone or trashed or has no such table.
    fn table_columns(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
    ) -> impl Future<Output = Result<Option<Vec<WebhookColumn>>, DatabaseError>> + Send;

    /// Insert rows, as an ordinary insert by `viewer`; the new rows' ids in
    /// order.
    fn insert_rows(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        table_id: TableId,
        rows: Vec<Vec<CellWrite>>,
    ) -> impl Future<Output = Result<Vec<RowId>, DatabaseError>> + Send;
}

/// Whether a webhook's creator can still edit its database.
pub trait CreatorAccess: Send + Sync + 'static {
    /// The creator's edit receipt for the database; `None` when they can no
    /// longer edit it.
    fn edit_receipt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
    ) -> impl Future<
        Output = Result<Option<EntityAccessReceipt<EditAccessLevel>>, rootcause::Report>,
    > + Send;
}
