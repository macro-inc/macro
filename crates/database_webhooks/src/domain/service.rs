//! The webhooks service: every decision beyond the receipt its caller
//! minted, over its ports.

#[cfg(test)]
mod test;

use databases::domain::models::{DatabaseError, Viewer};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, RequiredPermission,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{DatabaseId, TableId};
use serde_json::Value;

use crate::domain::mapping::{WebhookColumn, rows_from_payload};
use crate::domain::models::{
    CreatedWebhook, DatabaseWebhook, DatabaseWebhookError, Delivery, NewWebhook, PayloadProblem,
    WebhookId,
};
use crate::domain::ports::{
    CreatorAccess, DatabaseWebhooksRepo, DatabaseWebhooksService, WebhookTables,
};
use crate::domain::token;

/// The webhooks service over its ports.
#[derive(Debug, Clone)]
pub struct DatabaseWebhooksServiceImpl<Repository, Tables, Access> {
    repository: Repository,
    tables: Tables,
    access: Access,
}

impl<Repository, Tables, Access> DatabaseWebhooksServiceImpl<Repository, Tables, Access> {
    /// A service from its ports.
    pub fn new(repository: Repository, tables: Tables, access: Access) -> Self {
        Self {
            repository,
            tables,
            access,
        }
    }
}

/// The database a receipt was minted for.
fn receipt_database_id<Level: RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Result<DatabaseId, DatabaseWebhookError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::Database {
        return Err(DatabaseWebhookError::NotFound);
    }
    entity
        .entity_id
        .parse()
        .map_err(|_| DatabaseWebhookError::NotFound)
}

fn database_error(error: DatabaseError) -> DatabaseWebhookError {
    match error {
        DatabaseError::NotFound => DatabaseWebhookError::NotFound,
        other => DatabaseWebhookError::Database(other),
    }
}

/// A cell the databases service refused, as the payload's problem: its row
/// when the payload sent several, and its column by name.
fn refused_cell(
    error: DatabaseError,
    columns: &[WebhookColumn],
    several_rows: bool,
) -> DatabaseWebhookError {
    let DatabaseError::InvalidOp(refusal) = error else {
        return database_error(error);
    };
    let field = refusal.column.and_then(|refused| {
        columns
            .iter()
            .find(|column| column.id == refused)
            .map(|column| column.name.clone())
    });
    DatabaseWebhookError::InvalidPayload(vec![PayloadProblem {
        row: refusal.row.filter(|_| several_rows),
        field,
        message: refusal.reason,
    }])
}

impl<Repository, Tables, Access> DatabaseWebhooksService
    for DatabaseWebhooksServiceImpl<Repository, Tables, Access>
where
    Repository: DatabaseWebhooksRepo,
    Tables: WebhookTables,
    Access: CreatorAccess,
{
    #[tracing::instrument(skip(self, receipt), err)]
    async fn create_webhook(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
    ) -> Result<CreatedWebhook, DatabaseWebhookError> {
        let database_id = receipt_database_id(&receipt)?;
        let Some(creator) = receipt.acting_user_id() else {
            return Err(DatabaseWebhookError::Forbidden(
                "only a signed-in person can create a webhook",
            ));
        };
        self.tables
            .table_columns(database_id, table_id)
            .await
            .map_err(database_error)?
            .ok_or(DatabaseWebhookError::NotFound)?;
        let token = token::generate();
        let webhook = self
            .repository
            .insert_webhook(NewWebhook {
                id: macro_uuid::generate_uuid_v7(),
                database_id,
                table_id,
                created_by: creator.to_string(),
                token_hash: token::hash(&token),
                token_prefix: token::prefix(&token),
            })
            .await
            .map_err(DatabaseWebhookError::Repository)?;
        Ok(CreatedWebhook { webhook, token })
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn list_webhooks(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<Vec<DatabaseWebhook>, DatabaseWebhookError> {
        let database_id = receipt_database_id(&receipt)?;
        self.repository
            .database_webhooks(database_id)
            .await
            .map_err(DatabaseWebhookError::Repository)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn delete_webhook(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        webhook_id: WebhookId,
    ) -> Result<(), DatabaseWebhookError> {
        let database_id = receipt_database_id(&receipt)?;
        let deleted = self
            .repository
            .delete_webhook(database_id, webhook_id)
            .await
            .map_err(DatabaseWebhookError::Repository)?;
        if deleted {
            Ok(())
        } else {
            Err(DatabaseWebhookError::NotFound)
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn deliver(
        &self,
        token: &str,
        payload: &Value,
    ) -> Result<Delivery, DatabaseWebhookError> {
        let webhook = self
            .repository
            .webhook_by_token_hash(token::hash(token))
            .await
            .map_err(DatabaseWebhookError::Repository)?
            .ok_or(DatabaseWebhookError::NotFound)?;
        let creator = MacroUserIdStr::try_from(webhook.created_by.clone()).map_err(|error| {
            DatabaseWebhookError::Repository(rootcause::report!(
                "stored webhook creator is not a user id: {error}"
            ))
        })?;
        let receipt = self
            .access
            .edit_receipt(&creator, webhook.database_id)
            .await
            .map_err(DatabaseWebhookError::Repository)?
            .ok_or(DatabaseWebhookError::Forbidden(
                "the webhook's creator can no longer edit this database",
            ))?;
        let columns = self
            .tables
            .table_columns(webhook.database_id, webhook.table_id)
            .await
            .map_err(database_error)?
            .ok_or(DatabaseWebhookError::NotFound)?;
        let rows =
            rows_from_payload(&columns, payload).map_err(DatabaseWebhookError::InvalidPayload)?;
        let rows = self
            .tables
            .insert_rows(
                receipt,
                Viewer {
                    user_id: creator,
                    acting_bot: None,
                },
                webhook.table_id,
                rows,
            )
            .await
            .map_err(|error| refused_cell(error, &columns, payload.is_array()))?;
        Ok(Delivery {
            database_id: webhook.database_id,
            table_id: webhook.table_id,
            rows,
        })
    }
}
