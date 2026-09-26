use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use entity_access::domain::models::{EntityAccessReceipt, EntityPermission, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::{
    property_definition::PropertyDefinition, property_option::PropertyOption,
};
use rootcause::markers::{Cloneable, Dynamic};
use uuid::Uuid;

use crate::definitions::GraphqlPropertyDefinitionScope;

/// Whether the canonical entity type supports property targets.
fn is_property_target(entity_type: model_entity::EntityType) -> bool {
    use model_entity::EntityType;
    matches!(
        entity_type,
        EntityType::Document
            | EntityType::EmailThread
            | EntityType::CrmCompany
            | EntityType::Call
            | EntityType::Chat
            | EntityType::Channel
            | EntityType::Project
            | EntityType::Initiative
            | EntityType::User
    )
}

/// Reader used by GraphQL property edges.
pub trait EntityPropertyReader: Send + Sync + 'static {
    /// List definitions visible to the authenticated caller in the requested scope.
    fn get_definitions(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: GraphqlPropertyDefinitionScope,
        for_entity_type: Option<models_properties::EntityType>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinition>, rootcause::Report>> + Send;

    /// Read options after the properties service verifies definition visibility.
    fn get_options(
        &self,
        user_id: &MacroUserIdStr<'static>,
        property_definition_id: Uuid,
    ) -> impl Future<Output = Result<Vec<PropertyOption>, rootcause::Report>> + Send;

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
    async fn get_definitions(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _scope: GraphqlPropertyDefinitionScope,
        _for_entity_type: Option<models_properties::EntityType>,
    ) -> Result<Vec<PropertyDefinition>, rootcause::Report> {
        Err(rootcause::report!("property reader is not configured"))
    }

    async fn get_options(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _property_definition_id: Uuid,
    ) -> Result<Vec<PropertyOption>, rootcause::Report> {
        Err(rootcause::report!("property reader is not configured"))
    }

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
    /// Domain service used to load properties.
    properties_service: Arc<P>,
    /// Access service used to authorize each requested entity.
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

impl<P, A: EntityAccessService> PropertiesEntityPropertyReader<P, A> {
    /// Mint membership proof from the canonical access service for owner-scoped reads.
    async fn caller_team_receipt(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Option<properties::domain::service::TeamReceipt>, rootcause::Report> {
        let Some(team) = self
            .entity_access_service
            .get_user_team(user_id)
            .await
            .map_err(|err| rootcause::report!(err))?
        else {
            return Ok(None);
        };
        Ok(EntityAccessReceipt::try_new_authenticated_user(
            user_id.clone(),
            entity_access::domain::models::Entity {
                entity_id: team.team_id.to_string(),
                entity_type: model_entity::EntityType::Team,
            },
            EntityPermission::TeamRole { role: team.role },
        )
        .map(Some)
        .map_err(|err| rootcause::report!(err))?)
    }
}

impl<P, A> EntityPropertyReader for PropertiesEntityPropertyReader<P, A>
where
    P: properties::PropertiesService,
    A: EntityAccessService,
{
    async fn get_definitions(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: GraphqlPropertyDefinitionScope,
        for_entity_type: Option<models_properties::EntityType>,
    ) -> Result<Vec<PropertyDefinition>, rootcause::Report> {
        let team = match scope {
            GraphqlPropertyDefinitionScope::Team | GraphqlPropertyDefinitionScope::All => {
                self.caller_team_receipt(user_id).await?
            }
            GraphqlPropertyDefinitionScope::User | GraphqlPropertyDefinitionScope::System => None,
        };
        let (user, include_system) = match scope {
            GraphqlPropertyDefinitionScope::User => (Some(user_id), false),
            GraphqlPropertyDefinitionScope::Team => (None, false),
            GraphqlPropertyDefinitionScope::System => (None, true),
            GraphqlPropertyDefinitionScope::All => (Some(user_id), true),
        };
        Ok(self
            .properties_service
            .list_property_definitions(team.as_ref(), user, include_system, for_entity_type)
            .await
            .map_err(|err| rootcause::report!(err))?)
    }

    async fn get_options(
        &self,
        user_id: &MacroUserIdStr<'static>,
        property_definition_id: Uuid,
    ) -> Result<Vec<PropertyOption>, rootcause::Report> {
        let team = self.caller_team_receipt(user_id).await?;
        Ok(self
            .properties_service
            .get_property_options(property_definition_id, user_id, team.as_ref())
            .await
            .map_err(|err| rootcause::report!(err))?)
    }

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
            if !is_property_target(key.entity_type) {
                continue;
            }
            let access_receipt = self
                .entity_access_service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    user_id,
                    None,
                    &key.entity_id,
                    key.entity_type,
                )
                .await;
            match access_receipt {
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

        // Merge back under the original canonical loader keys.
        for key in keys {
            if !is_property_target(key.entity_type) {
                continue;
            }
            let batch_key = properties::PropertyTargetKey {
                entity_id: key.entity_id.to_string(),
                entity_type: key.entity_type,
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
    /// User on whose behalf properties are loaded.
    user_id: MacroUserIdStr<'static>,
    /// Property reader used to fulfill batches.
    reader: R,
}

impl<R> EntityPropertiesLoader<R> {
    /// Create a new entity properties DataLoader scoped to the requesting user.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: R) -> Self {
        Self { user_id, reader }
    }
}

impl<R: EntityPropertyReader> EntityPropertiesLoader<R> {
    /// Load definitions using the same authenticated identity as property edges.
    pub(crate) async fn definitions(
        &self,
        scope: GraphqlPropertyDefinitionScope,
        for_entity_type: Option<models_properties::EntityType>,
    ) -> Result<Vec<PropertyDefinition>, rootcause::Report> {
        self.reader
            .get_definitions(&self.user_id, scope, for_entity_type)
            .await
    }

    /// Load options using the same authenticated identity as property edges.
    pub(crate) async fn options(
        &self,
        definition_id: Uuid,
    ) -> Result<Vec<PropertyOption>, rootcause::Report> {
        self.reader.get_options(&self.user_id, definition_id).await
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
