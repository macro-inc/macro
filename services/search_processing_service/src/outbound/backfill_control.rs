//! The backfill pause switch, kept as one item in the backfill jobs table so
//! every task reads the same state.

use std::sync::Arc;

use aws_sdk_dynamodb::{Client, types::AttributeValue};

use crate::domain::{models::BackfillError, ports::BackfillControl};

/// The switch's item key. Job items are keyed by job id, which never takes
/// this form, and the switch carries no `expires_at`, so the table's TTL
/// sweep never removes it.
const SWITCH_ID: &str = "control:backfills";
const PAUSED: &str = "paused";

/// DynamoDB-backed [`BackfillControl`].
#[derive(Clone)]
pub struct DynamoBackfillControl {
    client: Client,
    table: Arc<str>,
}

impl DynamoBackfillControl {
    pub fn new(client: Client, table: impl Into<Arc<str>>) -> Self {
        Self {
            client,
            table: table.into(),
        }
    }
}

impl BackfillControl for DynamoBackfillControl {
    async fn paused(&self) -> Result<bool, BackfillError> {
        let item = self
            .client
            .get_item()
            .table_name(self.table.as_ref())
            .key("id", AttributeValue::S(SWITCH_ID.to_owned()))
            .consistent_read(true)
            .send()
            .await
            .map_err(|error| BackfillError::Control(error.into()))?;
        Ok(item
            .item()
            .and_then(|item| item.get(PAUSED))
            .and_then(|value| value.as_bool().ok())
            .copied()
            .unwrap_or(false))
    }

    async fn set_paused(&self, paused: bool) -> Result<(), BackfillError> {
        self.client
            .put_item()
            .table_name(self.table.as_ref())
            .item("id", AttributeValue::S(SWITCH_ID.to_owned()))
            .item(PAUSED, AttributeValue::Bool(paused))
            .item(
                "updated_at",
                AttributeValue::S(chrono::Utc::now().to_rfc3339()),
            )
            .send()
            .await
            .map_err(|error| BackfillError::Control(error.into()))?;
        Ok(())
    }
}
