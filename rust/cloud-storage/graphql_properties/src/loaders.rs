use std::{collections::HashMap, str::FromStr, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use macro_user_id::user_id::MacroUserIdStr;
use models_soup::SoupProperty;

/// Key for loading properties attached to an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityPropertiesKey {
    /// Entity type key used by the property service.
    pub entity_type: String,
    /// Entity ID used by the property service.
    pub entity_id: String,
}

impl EntityPropertiesKey {
    fn property_entity_type(
        &self,
    ) -> Result<Option<models_properties::EntityType>, rootcause::Report> {
        match self.entity_type.as_str() {
            "email" | "email_thread" => Ok(Some(models_properties::EntityType::Thread)),
            "crm_company" => Ok(Some(models_properties::EntityType::Company)),
            "call" | "channel_message" | "channel_thread" | "foreign_entity" | "github" => Ok(None),
            other => models_properties::EntityType::from_str(other)
                .map(Some)
                .map_err(|err| {
                    rootcause::report!("invalid entity type {other} for property edge: {err}")
                }),
        }
    }
}

/// Object-safe reader used by GraphQL property edges.
#[async_trait::async_trait]
pub trait SoupPropertyEdgeReader: Send + Sync + 'static {
    /// Load properties for the requested entity keys on behalf of the given
    /// user. Entities the user cannot view yield an empty property list.
    async fn get_properties(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report>;
}

#[async_trait::async_trait]
impl<T> SoupPropertyEdgeReader for T
where
    T: properties::PropertiesService,
{
    async fn get_properties(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report> {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        // Mint a view receipt per entity; entities the caller cannot view are
        // skipped and keep their empty property list.
        let mut receipts = Vec::with_capacity(keys.len());
        for key in &keys {
            let Some(entity_type) = key.property_entity_type()? else {
                continue;
            };
            match self
                .mint_view_receipt(Some(user_id), &key.entity_id, entity_type)
                .await
            {
                Ok(receipt) => receipts.push(receipt),
                Err(err) => {
                    tracing::debug!(
                        entity_id = %key.entity_id,
                        entity_type = %key.entity_type,
                        error = ?err,
                        "user lacks view permission, skipping property edge"
                    );
                }
            }
        }

        if receipts.is_empty() {
            return Ok(result);
        }

        let properties_by_entity = self
            .get_bulk_entity_properties(&receipts, Vec::new())
            .await
            .map_err(|err| rootcause::report!(err))?;

        // Merge back under the original loader keys: the batch result is keyed
        // by the normalized entity type, which for alias keys ("email",
        // "email_thread", "crm_company") differs from the requested key.
        for key in &keys {
            let Ok(Some(entity_type)) = key.property_entity_type() else {
                continue;
            };
            let batch_key = properties::EntityPropertiesKey {
                entity_id: key.entity_id.clone(),
                entity_type,
            };
            if let Some(properties) = properties_by_entity.get(&batch_key) {
                result.insert(
                    key.clone(),
                    properties.iter().cloned().map(SoupProperty::from).collect(),
                );
            }
        }

        Ok(result)
    }
}

/// DataLoader for entity property edges.
pub struct EntityPropertiesLoader {
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupPropertyEdgeReader>,
}

impl EntityPropertiesLoader {
    /// Create a new entity properties DataLoader scoped to the requesting user.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: Arc<dyn SoupPropertyEdgeReader>) -> Self {
        Self { user_id, reader }
    }
}

impl Loader<EntityPropertiesKey> for EntityPropertiesLoader {
    type Value = Vec<SoupProperty>;
    type Error = Arc<rootcause::Report>;

    async fn load(
        &self,
        keys: &[EntityPropertiesKey],
    ) -> Result<HashMap<EntityPropertiesKey, Self::Value>, Self::Error> {
        self.reader
            .get_properties(&self.user_id, keys.to_vec())
            .await
            .map_err(Arc::new)
    }
}

/// Build a DataLoader for entity property edges scoped to the requesting user.
pub fn entity_properties_loader(
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupPropertyEdgeReader>,
) -> DataLoader<EntityPropertiesLoader> {
    DataLoader::new(EntityPropertiesLoader::new(user_id, reader), tokio::spawn)
}
