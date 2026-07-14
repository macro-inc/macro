use std::{collections::HashMap, str::FromStr, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use entity_access::domain::models::ViewAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use rootcause::markers::{Cloneable, Dynamic};

fn property_entity_type(
    entity_type: model_entity::EntityType,
) -> Option<models_properties::EntityType> {
    use model_entity::EntityType;
    match entity_type {
        EntityType::EmailThread => Some(models_properties::EntityType::Thread),
        EntityType::CrmCompany => Some(models_properties::EntityType::Company),
        EntityType::Call | EntityType::ChannelMessage | EntityType::ForeignEntity => None,
        other => models_properties::EntityType::from_str(other.as_ref()).ok(),
    }
}

/// Reader used by GraphQL property edges.
pub trait EntityPropertyReader: Send + Sync + 'static {
    /// Load properties for the requested entity keys on behalf of the given
    /// user. Entities the user cannot view yield an empty property list.
    fn get_properties(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: &[model_entity::Entity<'static>],
    ) -> impl Future<
        Output = Result<
            HashMap<model_entity::Entity<'static>, Vec<EntityPropertyWithDefinition>>,
            rootcause::Report,
        >,
    > + Send;
}

/// Property reader used by schema-only GraphQL construction.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpEntityPropertyReader;

impl EntityPropertyReader for NoOpEntityPropertyReader {
    async fn get_properties(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        keys: &[model_entity::Entity<'static>],
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<EntityPropertyWithDefinition>>,
        rootcause::Report,
    > {
        Ok(keys.iter().cloned().map(|key| (key, Vec::new())).collect())
    }
}

/// GraphQL property reader backed by the properties domain service and the
/// canonical entity access service.
pub struct PropertiesEntityPropertyReader<P, A> {
    properties_service: Arc<P>,
    entity_access_service: Arc<A>,
}

impl<P, A> PropertiesEntityPropertyReader<P, A> {
    /// Create a property edge reader from the services supplied by the
    /// application composition root.
    pub fn new(properties_service: Arc<P>, entity_access_service: Arc<A>) -> Self {
        Self {
            properties_service,
            entity_access_service,
        }
    }
}

impl<P, A> EntityPropertyReader for PropertiesEntityPropertyReader<P, A>
where
    P: properties::PropertiesService,
    A: EntityAccessService,
{
    async fn get_properties(
        &self,
        user_id: &MacroUserIdStr<'static>,
        keys: &[model_entity::Entity<'static>],
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<EntityPropertyWithDefinition>>,
        rootcause::Report,
    > {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        // Mint a view receipt per entity; entities the caller cannot view are
        // skipped and keep their empty property list.
        let mut receipts = Vec::with_capacity(keys.len());
        for key in keys {
            let Some(entity_type) = property_entity_type(key.entity_type) else {
                continue;
            };
            let access_receipt = self
                .entity_access_service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    user_id,
                    None,
                    &key.entity_id,
                    properties::access_entity_type(entity_type),
                )
                .await;
            match access_receipt.and_then(|receipt| {
                properties::PropertiesAccessReceipt::try_from_entity_access_receipt(
                    receipt,
                    entity_type,
                )
            }) {
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
            .properties_service
            .get_bulk_entity_properties(&receipts, Vec::new())
            .await
            .map_err(|err| rootcause::report!(err))?;

        // Merge back under the original loader keys: the batch result is keyed
        // by the normalized entity type, which for alias keys ("email",
        // "email_thread", "crm_company") differs from the requested key.
        for key in keys {
            let Some(entity_type) = property_entity_type(key.entity_type) else {
                continue;
            };
            let batch_key = properties::EntityPropertiesKey {
                entity_id: key.entity_id.to_string(),
                entity_type,
            };
            if let Some(properties) = properties_by_entity.get(&batch_key) {
                result.insert(key.clone(), properties.clone());
            }
        }

        Ok(result)
    }
}

/// DataLoader for entity property edges.
pub struct EntityPropertiesLoader<R> {
    user_id: MacroUserIdStr<'static>,
    reader: R,
}

impl<R> EntityPropertiesLoader<R> {
    /// Create a new entity properties DataLoader scoped to the requesting user.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: R) -> Self {
        Self { user_id, reader }
    }
}

impl<R> Loader<model_entity::OwnedEntity> for EntityPropertiesLoader<R>
where
    R: EntityPropertyReader,
{
    type Value = Vec<EntityPropertyWithDefinition>;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(
        &self,
        keys: &[model_entity::OwnedEntity],
    ) -> Result<HashMap<model_entity::OwnedEntity, Self::Value>, Self::Error> {
        let entities = keys
            .iter()
            .map(|key| key.as_entity().clone())
            .collect::<Vec<_>>();
        let loaded = self
            .reader
            .get_properties(&self.user_id, &entities)
            .await
            .map_err(|error| error.into_cloneable())?;

        Ok(keys
            .iter()
            .cloned()
            .map(|key| {
                let properties = loaded.get(key.as_entity()).cloned().unwrap_or_default();
                (key, properties)
            })
            .collect())
    }
}

/// Build a DataLoader for entity property edges scoped to the requesting user.
pub fn entity_properties_loader<R>(
    user_id: MacroUserIdStr<'static>,
    reader: R,
) -> DataLoader<EntityPropertiesLoader<R>>
where
    R: EntityPropertyReader,
{
    DataLoader::new(EntityPropertiesLoader::new(user_id, reader), tokio::spawn)
}
