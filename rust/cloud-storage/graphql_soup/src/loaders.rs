use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityReference;
use models_soup::SoupProperty;
use notification::domain::models::{UserNotificationRow, request::NotificationEntityRef};

use crate::mappings::{
    notification_item_type_from_key, notification_item_type_key, property_entity_type_from_key,
};

/// Key for loading properties attached to an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityPropertiesKey {
    /// Entity type key used by the property service.
    pub entity_type: String,
    /// Entity ID used by the property service.
    pub entity_id: String,
}

/// Object-safe reader used by GraphQL property edges.
#[async_trait::async_trait]
pub trait SoupPropertyEdgeReader: Send + Sync + 'static {
    /// Load properties for the requested entity keys.
    async fn get_properties(
        &self,
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
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report> {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        let entity_refs = keys
            .iter()
            .filter_map(
                |key| match property_entity_type_from_key(&key.entity_type) {
                    Ok(Some(entity_type)) => {
                        Some(Ok(EntityReference::new(key.entity_id.clone(), entity_type)))
                    }
                    Ok(None) => None,
                    Err(err) => Some(Err(err)),
                },
            )
            .collect::<Result<Vec<_>, rootcause::Report>>()?;

        let properties_by_entity = self
            .get_entity_properties_batch(entity_refs)
            .await
            .map_err(|err| rootcause::report!(err))?;

        for (key, properties) in properties_by_entity {
            result.insert(
                EntityPropertiesKey {
                    entity_id: key.entity_id,
                    entity_type: key.entity_type.to_string(),
                },
                properties.into_iter().map(SoupProperty::from).collect(),
            );
        }

        Ok(result)
    }
}

/// DataLoader for entity property edges.
pub struct EntityPropertiesLoader {
    reader: Arc<dyn SoupPropertyEdgeReader>,
}

impl EntityPropertiesLoader {
    /// Create a new entity properties DataLoader.
    pub fn new(reader: Arc<dyn SoupPropertyEdgeReader>) -> Self {
        Self { reader }
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
            .get_properties(keys.to_vec())
            .await
            .map_err(Arc::new)
    }
}

/// Build a DataLoader for entity property edges.
pub fn entity_properties_loader(
    reader: Arc<dyn SoupPropertyEdgeReader>,
) -> DataLoader<EntityPropertiesLoader> {
    DataLoader::new(EntityPropertiesLoader::new(reader), tokio::spawn)
}

/// Key for loading notifications attached to an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityNotificationsKey {
    /// Entity type key used by the notification service.
    pub entity_type: String,
    /// Entity ID used by the notification service.
    pub entity_id: String,
}

/// Object-safe reader used by GraphQL notification edges.
#[async_trait::async_trait]
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load notifications for the requested entity keys.
    async fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<EntityNotificationsKey>,
    ) -> Result<
        HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    >;
}

#[async_trait::async_trait]
impl<T> SoupNotificationEdgeReader for T
where
    T: notification::domain::service::NotificationReader,
{
    async fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<EntityNotificationsKey>,
    ) -> Result<
        HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    > {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        let entity_refs = keys
            .iter()
            .map(|key| {
                Ok(NotificationEntityRef {
                    entity_type: notification_item_type_from_key(&key.entity_type)?,
                    id: key.entity_id.clone(),
                })
            })
            .collect::<Result<Vec<_>, rootcause::Report>>()?;

        let notifications_by_entity = self
            .get_entity_notifications_batch(user_id, entity_refs)
            .await
            .map_err(|err| rootcause::report!(err))?;

        for (key, notifications) in notifications_by_entity {
            result.insert(
                EntityNotificationsKey {
                    entity_type: notification_item_type_key(key.entity_type).to_owned(),
                    entity_id: key.id,
                },
                notifications,
            );
        }

        Ok(result)
    }
}

/// DataLoader for entity notification edges.
pub struct EntityNotificationsLoader {
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupNotificationEdgeReader>,
}

impl EntityNotificationsLoader {
    /// Create a new entity notifications DataLoader.
    pub fn new(
        user_id: MacroUserIdStr<'static>,
        reader: Arc<dyn SoupNotificationEdgeReader>,
    ) -> Self {
        Self { user_id, reader }
    }
}

impl Loader<EntityNotificationsKey> for EntityNotificationsLoader {
    type Value = Vec<UserNotificationRow<serde_json::Value>>;
    type Error = Arc<rootcause::Report>;

    async fn load(
        &self,
        keys: &[EntityNotificationsKey],
    ) -> Result<HashMap<EntityNotificationsKey, Self::Value>, Self::Error> {
        self.reader
            .get_notifications(self.user_id.clone(), keys.to_vec())
            .await
            .map_err(Arc::new)
    }
}

/// Build a DataLoader for entity notification edges.
pub fn entity_notifications_loader(
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupNotificationEdgeReader>,
) -> DataLoader<EntityNotificationsLoader> {
    DataLoader::new(
        EntityNotificationsLoader::new(user_id, reader),
        tokio::spawn,
    )
}
