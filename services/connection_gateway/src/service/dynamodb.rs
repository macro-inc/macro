use crate::model::connection::StoredConnectionEntity;
use crate::model::tracking::{EntityConnection, UserEntityConnection};
use crate::service::connection::{ConnectionManager, ConnectionRepo};
use anyhow::{Context, Result};
use async_trait::async_trait;
use aws_sdk_dynamodb::error::ProvideErrorMetadata;
use aws_sdk_dynamodb::types::{AttributeValue, ReturnValue};
use ensure_exists::dynamodb::{CreateTableErr, DefineTable, DynamoClientWrapper};
use ensure_exists::{DoesExist, EnsureExists};
use macro_env_var::env_var;
use model_entity::{Entity, EntityType};
use std::collections::HashMap;

env_var! {
    #[derive(Debug, Clone)]
    pub struct ConnectionGatewayTable;
}

impl DefineTable for ConnectionGatewayTable {
    async fn create_table(&self, client: &aws_sdk_dynamodb::Client) -> Result<(), CreateTableErr> {
        let table_name = self.as_ref();

        client
            .create_table()
            .table_name(table_name)
            .key_schema(
                aws_sdk_dynamodb::types::KeySchemaElement::builder()
                    .attribute_name("PK")
                    .key_type(aws_sdk_dynamodb::types::KeyType::Hash)
                    .build()
                    .map_err(aws_sdk_dynamodb::Error::from)?,
            )
            .key_schema(
                aws_sdk_dynamodb::types::KeySchemaElement::builder()
                    .attribute_name("SK")
                    .key_type(aws_sdk_dynamodb::types::KeyType::Range)
                    .build()
                    .map_err(aws_sdk_dynamodb::Error::from)?,
            )
            .attribute_definitions(
                aws_sdk_dynamodb::types::AttributeDefinition::builder()
                    .attribute_name("PK")
                    .attribute_type(aws_sdk_dynamodb::types::ScalarAttributeType::S)
                    .build()
                    .map_err(aws_sdk_dynamodb::Error::from)?,
            )
            .attribute_definitions(
                aws_sdk_dynamodb::types::AttributeDefinition::builder()
                    .attribute_name("SK")
                    .attribute_type(aws_sdk_dynamodb::types::ScalarAttributeType::S)
                    .build()
                    .map_err(aws_sdk_dynamodb::Error::from)?,
            )
            .global_secondary_indexes(
                aws_sdk_dynamodb::types::GlobalSecondaryIndex::builder()
                    .index_name("ConnectionPkIndex")
                    .key_schema(
                        aws_sdk_dynamodb::types::KeySchemaElement::builder()
                            .attribute_name("SK")
                            .key_type(aws_sdk_dynamodb::types::KeyType::Hash)
                            .build()
                            .map_err(aws_sdk_dynamodb::Error::from)?,
                    )
                    .key_schema(
                        aws_sdk_dynamodb::types::KeySchemaElement::builder()
                            .attribute_name("PK")
                            .key_type(aws_sdk_dynamodb::types::KeyType::Range)
                            .build()
                            .map_err(aws_sdk_dynamodb::Error::from)?,
                    )
                    .projection(
                        aws_sdk_dynamodb::types::Projection::builder()
                            .projection_type(aws_sdk_dynamodb::types::ProjectionType::All)
                            .build(),
                    )
                    .build()
                    .map_err(aws_sdk_dynamodb::Error::from)?,
            )
            .billing_mode(aws_sdk_dynamodb::types::BillingMode::PayPerRequest)
            .send()
            .await
            .map_err(aws_sdk_dynamodb::Error::from)?;

        Ok(())
    }
}

struct DynamoDbConnectionGatewayPersistence {
    client: aws_sdk_dynamodb::Client,
    table_exists: DoesExist<ConnectionGatewayTable>,
}

const CONNECTION_ID_GSI: &str = "ConnectionPkIndex";

/// The attributes every connection entry has, besides its keys.
const ENTRY_ATTRIBUTES: [&str; 5] = [
    "entity_type",
    "entity_id",
    "connection_id",
    "created_at",
    "user_id",
];

/// A row in the table that does not read as a connection entry.
#[derive(Debug, PartialEq, Eq)]
struct MalformedRow {
    pk: String,
    sk: String,
    /// The [ENTRY_ATTRIBUTES] the row lacks. A row lacking any can never be
    /// a live connection: pings wrote rows like that for entries already
    /// gone, before they checked that their row exists. A row lacking none
    /// is whole but unreadable here, such as one a newer instance wrote with
    /// an entity type this one does not know.
    missing: Vec<&'static str>,
}

/// Rows read from the table, split into connection entries and the rows that
/// are not one.
#[derive(Debug, Default)]
struct ReadRows {
    entries: Vec<StoredConnectionEntity>,
    malformed: Vec<MalformedRow>,
}

fn read_rows(items: Vec<HashMap<String, AttributeValue>>) -> Result<ReadRows> {
    let mut rows = ReadRows::default();
    for item in items {
        let key = |name: &str| {
            item.get(name)
                .and_then(|value| value.as_s().ok())
                .cloned()
                .with_context(|| format!("connection row without a {name} key"))
        };
        let (pk, sk) = (key("PK")?, key("SK")?);
        let missing = ENTRY_ATTRIBUTES
            .into_iter()
            .filter(|attribute| !item.contains_key(*attribute))
            .collect();
        match serde_dynamo::from_item(item) {
            Ok(entry) => rows.entries.push(entry),
            Err(_) => rows.malformed.push(MalformedRow { pk, sk, missing }),
        }
    }
    Ok(rows)
}

impl DynamoDbConnectionGatewayPersistence {
    /// The connection entries among `items`, deleting the rows that can never
    /// be one so they stop costing every read of their entity.
    ///
    /// A malformed row is left out rather than failing the read: it is one
    /// connection, and failing would cut off every other connection to the
    /// entity, and every other entity in a batch send beside it.
    async fn connection_entries(
        &self,
        items: Vec<HashMap<String, AttributeValue>>,
    ) -> Result<Vec<StoredConnectionEntity>> {
        let ReadRows { entries, malformed } = read_rows(items)?;
        for row in malformed {
            if row.missing.is_empty() {
                tracing::warn!(
                    connection_id = %row.sk,
                    "skipping a connection row this instance cannot read"
                );
                continue;
            }
            let retired = self.retire(&row).await;
            tracing::warn!(
                connection_id = %row.sk,
                missing = ?row.missing,
                retired = retired.is_ok(),
                error = ?retired.err(),
                "skipping a connection row missing entry attributes"
            );
        }
        Ok(entries)
    }

    /// Deletes a row missing entry attributes, unless a whole entry has
    /// replaced it since it was read.
    async fn retire(&self, row: &MalformedRow) -> Result<()> {
        let names: HashMap<String, String> = row
            .missing
            .iter()
            .map(|attribute| (format!("#{attribute}"), (*attribute).to_owned()))
            .collect();
        let condition = row
            .missing
            .iter()
            .map(|attribute| format!("attribute_not_exists(#{attribute})"))
            .collect::<Vec<_>>()
            .join(" AND ");

        match self
            .client
            .delete_item()
            .table_name(self.table_exists.as_ref())
            .key("PK", AttributeValue::S(row.pk.clone()))
            .key("SK", AttributeValue::S(row.sk.clone()))
            .condition_expression(condition)
            .set_expression_attribute_names(Some(names))
            .send()
            .await
        {
            Ok(_) => Ok(()),
            Err(e)
                if e.as_service_error().and_then(|se| se.code())
                    == Some("ConditionalCheckFailedException") =>
            {
                Ok(())
            }
            Err(e) => Err(aws_sdk_dynamodb::Error::from(e)).context("failed to delete row"),
        }
    }
}

#[async_trait]
impl ConnectionRepo for DynamoDbConnectionGatewayPersistence {
    async fn insert_connection_entry(
        &self,
        connection: UserEntityConnection<'_>,
    ) -> Result<StoredConnectionEntity> {
        let stored_connection = StoredConnectionEntity::from(connection);
        let item = serde_dynamo::to_item(stored_connection.clone())?;
        self.client
            .put_item()
            .table_name(self.table_exists.as_ref())
            .set_item(Some(item))
            .send()
            .await
            .context("failed to put item")?;

        Ok(stored_connection)
    }

    async fn get_entries_by_entity(
        &self,
        entity: &Entity<'_>,
    ) -> Result<Vec<StoredConnectionEntity>> {
        let result = self
            .client
            .query()
            .table_name(self.table_exists.as_ref())
            .key_condition_expression("PK = :primary_key") // Just the hash key condition
            // Read right after the open, ping, or close that prompted it; an
            // eventually consistent read can miss that write and send viewers
            // a list without the user who just opened.
            .consistent_read(true)
            .expression_attribute_values(
                ":primary_key",
                AttributeValue::S(format!("#{}#{}", entity.entity_type, entity.entity_id)),
            )
            .send()
            .await?
            .items
            .context("no items found")?;

        self.connection_entries(result).await
    }

    async fn get_entries_by_connection_id(
        &self,
        connection_id: &str,
    ) -> Result<Vec<StoredConnectionEntity>> {
        let result = self
            .client
            .query()
            .table_name(self.table_exists.as_ref())
            .index_name(CONNECTION_ID_GSI)
            .key_condition_expression("SK = :connection_id") // Just the hash key condition
            .expression_attribute_values(
                ":connection_id",
                AttributeValue::S(connection_id.to_string()),
            )
            .send()
            .await?
            .items
            .context("no items found")?;

        self.connection_entries(result).await
    }

    async fn get_connection(&self, connection_id: &str) -> Result<StoredConnectionEntity> {
        let result = self
            .client
            .query()
            .table_name(self.table_exists.as_ref())
            .key_condition_expression("begins_with(PK, :user_prefix) AND SK = :connection_id")
            .expression_attribute_values(
                ":user_prefix",
                AttributeValue::S(format!("#{}", EntityType::User)),
            )
            .expression_attribute_values(
                ":connection_id",
                AttributeValue::S(connection_id.to_string()),
            )
            .send()
            .await?;

        let items = result.items.context("no items found")?;

        self.connection_entries(items)
            .await?
            .into_iter()
            .next()
            .context("no items found")
    }

    async fn get_entry_for_connection_entity(
        &self,
        entity: EntityConnection<'_>,
    ) -> Result<Option<StoredConnectionEntity>> {
        let result = self
            .client
            .query()
            .table_name(self.table_exists.as_ref())
            .key_condition_expression("PK = :primary_key AND SK = :connection_id") // Combined hash and range key conditions
            .consistent_read(true)
            .expression_attribute_values(
                ":primary_key",
                AttributeValue::S(format!(
                    "#{}#{}",
                    entity.extra.entity_type, entity.extra.entity_id
                )),
            )
            .expression_attribute_values(
                ":connection_id",
                AttributeValue::S(entity.connection_id.to_string()),
            )
            .send()
            .await?
            .items
            .context("no items found")?;

        let items = self.connection_entries(result).await?;

        if items.len() > 1 {
            tracing::warn!(
                connection_id=?entity.connection_id,
                entity=?entity,
                "there should only be one entry for a given connection_id and entity combination"
            );
        }

        Ok(items.first().cloned())
    }

    async fn remove_all_entries_for_by_connection_id(&self, connection_id: &str) -> Result<()> {
        let connection_entities = self
            .get_entries_by_connection_id(connection_id)
            .await
            .context("failed to retrieve connection entities")?;

        for connection_entity in connection_entities {
            self.client
                .delete_item()
                .table_name(self.table_exists.as_ref())
                .key("PK", AttributeValue::S(connection_entity.pk))
                .key("SK", AttributeValue::S(connection_entity.sk))
                .send()
                .await?;
        }

        Ok(())
    }

    async fn remove_entity(&self, entity: &EntityConnection<'_>) -> Result<()> {
        let entity = match self
            .get_entry_for_connection_entity(entity.clone())
            .await
            .context("failed to retrieve connection entity")?
        {
            Some(entity) => entity,
            None => {
                tracing::debug!(
                    connection_id = %entity.connection_id,
                    entity_type = %entity.extra.entity_type,
                    entity_id = %entity.extra.entity_id,
                    "Entity already removed or never existed, skipping deletion"
                );
                return Ok(());
            }
        };

        self.client
            .delete_item()
            .table_name(self.table_exists.as_ref())
            .key("PK", AttributeValue::S(entity.pk))
            .key("SK", AttributeValue::S(entity.sk))
            .send()
            .await?;

        Ok(())
    }

    async fn update_last_entity_ping(
        &self,
        entity: &EntityConnection<'_>,
        timestamp: u64,
    ) -> Result<Option<StoredConnectionEntity>> {
        let pk = format!("#{}#{}", entity.extra.entity_type, entity.extra.entity_id);
        let sk = entity.connection_id.to_string();

        let mut names = HashMap::new();
        names.insert("#last_ping".to_string(), "last_ping".to_string());
        names.insert("#entity_type".to_string(), "entity_type".to_string());

        let res = match self
            .client
            .update_item()
            .table_name(self.table_exists.as_ref())
            .key("PK", AttributeValue::S(pk.clone()))
            .key("SK", AttributeValue::S(sk.clone()))
            .update_expression("SET #last_ping = :timestamp")
            .condition_expression("attribute_exists(#entity_type)")
            .set_expression_attribute_names(Some(names))
            .expression_attribute_values(":timestamp", AttributeValue::N(timestamp.to_string()))
            .return_values(ReturnValue::AllNew)
            .send()
            .await
        {
            Ok(res) => res,
            Err(e)
                if e.as_service_error().and_then(|se| se.code())
                    == Some("ConditionalCheckFailedException") =>
            {
                return Ok(None);
            }
            Err(e) => anyhow::bail!("Failed to update last_ping: {}", e),
        };

        let attrs = res
            .attributes
            .context("UpdateItem returned no attributes")?;

        let entity: StoredConnectionEntity =
            serde_dynamo::from_item(attrs).context("Unable to deserialize entity")?;

        Ok(Some(entity))
    }

    async fn update_user_connection_last_ping(
        &self,
        connection_id: &str,
        user: &str,
        timestamp: u64,
    ) -> Result<()> {
        let pk = format!("#{}#{}", EntityType::User, user);
        let sk = connection_id.to_string();

        let mut names = HashMap::new();
        names.insert("#last_ping".to_string(), "last_ping".to_string());
        names.insert("#entity_type".to_string(), "entity_type".to_string());

        self.client
            .update_item()
            .table_name(self.table_exists.as_ref())
            .key("PK", AttributeValue::S(pk))
            .key("SK", AttributeValue::S(sk))
            .update_expression("SET #last_ping = :timestamp")
            .condition_expression("attribute_exists(#entity_type)")
            .set_expression_attribute_names(Some(names))
            .expression_attribute_values(":timestamp", AttributeValue::N(timestamp.to_string()))
            .send()
            .await
            .map_err(|e| {
                if e.as_service_error()
                    .and_then(|se| se.code())
                    .map(|code| code == "ConditionalCheckFailedException")
                    .unwrap_or(false)
                {
                    anyhow::anyhow!("User connection no longer exists, skipping ping update")
                } else {
                    anyhow::anyhow!("Failed to update user connection last_ping: {}", e)
                }
            })?;

        Ok(())
    }
}

/// function which attempts to create a dynamodb backed [ConnectionManager]
/// this function will guarantee that the table exists
pub async fn create_dynamo_db_connection_manager(
    client: aws_sdk_dynamodb::Client,
) -> Result<ConnectionManager, anyhow::Error> {
    let table_name = ConnectionGatewayTable::new()?;
    let wrapper = DynamoClientWrapper {
        client: &client,
        table_name,
    };
    let table_exists = wrapper.ensure_exists().await?;

    let persistence = DynamoDbConnectionGatewayPersistence {
        client,
        table_exists,
    };

    Ok(ConnectionManager::new(persistence))
}

#[cfg(test)]
mod tests;
