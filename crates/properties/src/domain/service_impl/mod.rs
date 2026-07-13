//! Service implementation for properties.

mod helpers;
mod task_properties;

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::DataType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::api::{
    AddPropertyOptionRequest, CreatePropertyDefinitionRequest, CreatePropertyScope,
    PropertyDataType, UpdatePropertyOptionRequest, is_valid_hex_color,
};
use models_properties::convert_set_property_value_to_property_value;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityPropertyReference, EntityReference, EntityType};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use std::sync::Arc;

use super::error::PropertiesErr;
use super::metadata;
use super::model::{
    EditReceipt, EntityPropertiesKey, EntityPropertyInfo, PropertyDefinitionOwner, TagScope,
    TagSet, UpdatePropertyOptionOutcome, ViewReceipt,
};
use super::ports::{NotificationService, PermissionService, PropertiesRepo, PropertySearchIndexer};
use super::service::{PropertiesService, TeamReceipt, team_id_from_receipt};

use helpers::{
    extract_option_ids_from_property_value, is_property_applicable_to, retain_caller_visible_tags,
};

/// Entity types whose search index denormalizes property values, i.e. whose
/// property mutations must enqueue a search reindex.
fn is_search_indexed(entity_type: EntityType) -> bool {
    matches!(
        entity_type,
        EntityType::Task
            | EntityType::Document
            | EntityType::Thread
            | EntityType::Chat
            | EntityType::Project
    )
}

/// Implementation of PropertiesService using a repository and optional permission service.
#[derive(Debug)]
pub struct PropertiesServiceImpl<R, P, N>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
{
    repository: R,
    permission_service: Option<P>,
    notification_service: Option<N>,
    search_indexer: Option<Arc<dyn PropertySearchIndexer>>,
}

impl<R, P, N> PropertiesServiceImpl<R, P, N>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
{
    /// Create a new PropertiesService with optional permission service and notification service.
    pub fn new(
        repository: R,
        permission_service: Option<P>,
        notification_service: Option<N>,
    ) -> Self {
        Self {
            repository,
            permission_service,
            notification_service,
            search_indexer: None,
        }
    }

    /// Attach a search-reindex publisher so property mutations refresh the
    /// search index. Builder-style so existing constructions are unaffected.
    pub fn with_search_indexer(mut self, search_indexer: Arc<dyn PropertySearchIndexer>) -> Self {
        self.search_indexer = Some(search_indexer);
        self
    }

    /// The permission service, or the error every receipt-minting path maps a
    /// missing one to.
    fn permission_service(&self) -> Result<&P, PropertiesErr> {
        self.permission_service
            .as_ref()
            .ok_or(PropertiesErr::PermissionServiceNotConfigured)
    }

    /// Best-effort publish of a property reindex for entity types whose
    /// search index denormalizes property values. Logs and continues on
    /// failure so a missed reindex never fails the mutation itself.
    async fn enqueue_property_upsert(&self, entity_id: &str, entity_type: EntityType) {
        let Some(search_indexer) = self.search_indexer.as_ref() else {
            return;
        };
        if !is_search_indexed(entity_type) {
            return;
        }
        if let Err(error) = search_indexer
            .enqueue_upsert(entity_id.to_string(), entity_type)
            .await
        {
            tracing::warn!(error = ?error, entity_id = %entity_id, "failed to enqueue search reindex for property change");
        }
    }

    /// Fetch a property definition, ensuring it exists, isn't a system
    /// property, and is owned by the caller (their user property or a property
    /// of their team).
    async fn owned_modifiable_definition(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
    ) -> Result<PropertyDefinition, PropertiesErr>
    where
        anyhow::Error: From<R::Err>,
    {
        let property = self
            .repository
            .get_property_definition(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::NotFound)?;

        if property.is_system {
            return Err(PropertiesErr::SystemPropertyNotModifiable);
        }

        self.repository
            .get_property_definition_with_owner(property_definition_id, user_id, team_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::NotFound)
    }

    /// Resolve a tag set's options. A missing definition yields an empty set.
    async fn build_tag_set(
        &self,
        scope: TagScope,
        definition: Option<PropertyDefinition>,
    ) -> Result<TagSet, PropertiesErr>
    where
        anyhow::Error: From<R::Err>,
    {
        match definition {
            Some(definition) => {
                let options = self
                    .repository
                    .get_property_options(definition.id)
                    .await
                    .map_err(anyhow::Error::from)?;
                Ok(TagSet {
                    scope,
                    definition: Some(definition),
                    options,
                })
            }
            None => Ok(TagSet {
                scope,
                definition: None,
                options: Vec::new(),
            }),
        }
    }

    /// Validate that the given option IDs exist for the property definition.
    /// Returns an error if any option ID is invalid.
    pub async fn validate_property_options(
        &self,
        property_definition_id: Uuid,
        option_ids: &[Uuid],
    ) -> Result<(), PropertiesErr>
    where
        anyhow::Error: From<R::Err>,
    {
        if option_ids.is_empty() {
            return Ok(());
        }

        tracing::debug!(
            property_definition_id = %property_definition_id,
            option_ids = ?option_ids,
            "validating property options"
        );

        let valid_count = self
            .repository
            .count_valid_property_options(property_definition_id, option_ids)
            .await
            .map_err(anyhow::Error::from)?;

        if valid_count != option_ids.len() as i64 {
            return Err(PropertiesErr::Validation(format!(
                "Invalid property options: {} provided but only {} valid for property {}",
                option_ids.len(),
                valid_count,
                property_definition_id
            )));
        }

        Ok(())
    }
}

impl<R, P, N> PropertiesService for PropertiesServiceImpl<R, P, N>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    anyhow::Error: From<R::Err> + From<P::Err> + From<N::Err>,
{
    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type()), err)]
    async fn get_entity_properties(
        &self,
        access: &ViewReceipt,
    ) -> Result<Vec<EntityPropertyInfo>, PropertiesErr> {
        // Tag properties are filtered in the query to definitions the viewer
        // can see: their own and their teams'. Receipts without an
        // authenticated user (anonymous public / internal) see no tags.
        let tag_viewer_user_id = access
            .authenticated_user()
            .map(|user| user.as_ref())
            .unwrap_or_default();
        Ok(self
            .repository
            .get_entity_properties(access.entity_id(), access.entity_type(), tag_viewer_user_id)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_caller_tag_sets(
        &self,
        user_id: &str,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, PropertiesErr> {
        Ok(self
            .repository
            .get_caller_tag_definitions(user_id)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type(), property_definition_id = %property_definition_id))]
    async fn get_property_value(
        &self,
        access: &ViewReceipt,
        property_definition_id: Uuid,
    ) -> Result<Option<PropertyValue>, PropertiesErr> {
        Ok(self
            .repository
            .get_entity_property_value(
                access.entity_id(),
                access.entity_type(),
                property_definition_id,
            )
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type(), property_key = ?property_key))]
    async fn get_system_property_value(
        &self,
        access: &ViewReceipt,
        property_key: SystemPropertyKey,
    ) -> Result<Option<PropertyValue>, PropertiesErr> {
        self.get_property_value(access, property_key.uuid()).await
    }

    #[tracing::instrument(
        skip(self, access),
        fields(
            entity_id = %access.entity_id(),
            entity_type = ?access.entity_type(),
            property_definition_id = %property_definition_id,
            has_value = value.is_some()
        )
    )]
    async fn set_entity_property(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, PropertiesErr> {
        let entity_id = access.entity_id();
        let entity_type = access.entity_type();

        // Get property definition to validate it exists and for validation
        let property_definition = self
            .repository
            .get_property_definition(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or_else(|| {
                PropertiesErr::Validation(format!(
                    "Property definition not found: {}",
                    property_definition_id
                ))
            })?;

        // Determine the value to set (if any) and validate
        let property_value = match &value {
            Some(set_value) => {
                // Validate that the request value is compatible with the property definition
                set_value
                    .validate_compatibility(
                        &property_definition.data_type,
                        property_definition.is_multi_select,
                    )
                    .map_err(|e| {
                        PropertiesErr::Validation(format!(
                            "Property value validation failed: {}",
                            e
                        ))
                    })?;

                // Convert SetPropertyValue to PropertyValue (JSONB format)
                Some(convert_set_property_value_to_property_value(set_value))
            }
            None => {
                tracing::debug!("no value provided, attaching property without value");
                None
            }
        };

        // Validate property options at service layer (before upserting)
        let option_ids = extract_option_ids_from_property_value(&property_value);
        if !option_ids.is_empty() {
            self.validate_property_options(property_definition_id, &option_ids)
                .await?;
        }

        // Check if this property can be attached to the given entity type
        if !is_property_applicable_to(property_definition_id, entity_type) {
            return Err(PropertiesErr::Validation(
                "This property cannot be attached to this entity type".to_string(),
            ));
        }

        // Relationship writes update both sides transactionally and return the
        // primary entity's canonical assignment from that transaction.
        if matches!(
            property_definition_id,
            SystemPropertyKey::PARENT_TASK_UUID | SystemPropertyKey::SUBTASKS_UUID
        ) && entity_type == EntityType::Task
        {
            let property = self
                .handle_task_relationship_property(access, property_definition_id, value)
                .await?;
            return Ok(EntityPropertyWithDefinition {
                property,
                definition: property_definition,
                value: property_value,
                options: None,
            });
        }

        if property_definition_id == SystemPropertyKey::ASSIGNEES_UUID
            && entity_type == EntityType::Task
        {
            self.handle_task_assignees_property(entity_id, value, access.authenticated_user())
                .await?;
        }

        let property = self
            .repository
            .upsert_entity_property(
                entity_id,
                entity_type,
                property_definition_id,
                property_value.clone(),
            )
            .await
            .map_err(anyhow::Error::from)?;

        self.enqueue_property_upsert(entity_id, entity_type).await;

        Ok(EntityPropertyWithDefinition {
            property,
            definition: property_definition,
            value: property_value,
            options: None,
        })
    }

    #[tracing::instrument(
        skip(self, access),
        fields(
            entity_id = %access.entity_id(),
            entity_type = ?access.entity_type(),
            property_definition_id = %property_definition_id,
            option_id = %option_id
        )
    )]
    async fn add_entity_property_option(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> Result<(), PropertiesErr> {
        let property_definition = self
            .repository
            .get_property_definition(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or_else(|| {
                PropertiesErr::Validation(format!(
                    "Property definition not found: {}",
                    property_definition_id
                ))
            })?;

        if !property_definition.is_multi_select {
            return Err(PropertiesErr::Validation(
                "Option add/remove is only supported for multi-select properties".to_string(),
            ));
        }

        if !is_property_applicable_to(property_definition_id, access.entity_type()) {
            return Err(PropertiesErr::Validation(
                "This property cannot be attached to this entity type".to_string(),
            ));
        }

        self.validate_property_options(property_definition_id, &[option_id])
            .await?;

        self.repository
            .add_entity_property_option(
                access.entity_id(),
                access.entity_type(),
                property_definition_id,
                option_id,
            )
            .await
            .map_err(anyhow::Error::from)?;

        self.enqueue_property_upsert(access.entity_id(), access.entity_type())
            .await;

        Ok(())
    }

    #[tracing::instrument(
        skip(self, access),
        fields(
            entity_id = %access.entity_id(),
            entity_type = ?access.entity_type(),
            property_definition_id = %property_definition_id,
            option_id = %option_id
        )
    )]
    async fn remove_entity_property_option(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> Result<(), PropertiesErr> {
        self.repository
            .remove_entity_property_option(
                access.entity_id(),
                access.entity_type(),
                property_definition_id,
                option_id,
            )
            .await
            .map_err(anyhow::Error::from)?;

        self.enqueue_property_upsert(access.entity_id(), access.entity_type())
            .await;

        Ok(())
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn list_property_definitions(
        &self,
        team: Option<&TeamReceipt>,
        user_id: Option<&MacroUserIdStr<'_>>,
        include_system: bool,
        for_entity_type: Option<EntityType>,
    ) -> Result<Vec<PropertyDefinition>, PropertiesErr> {
        let definitions = self
            .repository
            .list_property_definitions(team_id_from_receipt(team), user_id, include_system)
            .await
            .map_err(anyhow::Error::from)?;

        Ok(definitions
            .into_iter()
            .filter(|d| {
                for_entity_type
                    .map(|et| is_property_applicable_to(d.id, et))
                    .unwrap_or(true)
            })
            .collect())
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn list_property_definitions_with_options(
        &self,
        team: Option<&TeamReceipt>,
        user_id: Option<&MacroUserIdStr<'_>>,
        include_system: bool,
        for_entity_type: Option<EntityType>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, PropertiesErr> {
        let definitions = self
            .repository
            .list_property_definitions_with_options(
                team_id_from_receipt(team),
                user_id,
                include_system,
            )
            .await
            .map_err(anyhow::Error::from)?;

        Ok(definitions
            .into_iter()
            .filter(|d| {
                for_entity_type
                    .map(|et| is_property_applicable_to(d.definition.id, et))
                    .unwrap_or(true)
            })
            .collect())
    }

    #[tracing::instrument(skip(self, team, request), fields(display_name = %request.display_name), err)]
    async fn create_property_definition(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        request: &CreatePropertyDefinitionRequest,
    ) -> Result<PropertyDefinition, PropertiesErr> {
        // Derive the owner from the authenticated caller - clients never supply owner ids.
        let owner = match request.scope {
            CreatePropertyScope::User => PropertyDefinitionOwner::User(user_id),
            CreatePropertyScope::Team => PropertyDefinitionOwner::Team(
                team_id_from_receipt(team).ok_or(PropertiesErr::TeamMembershipRequired)?,
            ),
        };

        if let Err(err) = request.validate() {
            return Err(PropertiesErr::Validation(err.to_string()));
        }

        let property_options = match &request.data_type {
            PropertyDataType::SelectString { options, .. } => options
                .iter()
                .map(|opt| {
                    build_property_option(
                        opt.display_order,
                        PropertyOptionValue::String(opt.value.clone()),
                    )
                })
                .collect(),
            PropertyDataType::SelectNumber { options, .. } => options
                .iter()
                .map(|opt| {
                    build_property_option(opt.display_order, PropertyOptionValue::Number(opt.value))
                })
                .collect(),
            _ => Vec::new(),
        };

        let property = self
            .repository
            .create_property_definition(
                owner,
                &request.display_name,
                request.data_type.to_data_type(),
                request.data_type.is_multi_select(),
                request.data_type.specific_entity_type(),
                property_options,
            )
            .await
            .map_err(anyhow::Error::from)?;

        tracing::info!(
            property_id = %property.id,
            data_type = ?property.data_type,
            "successfully created property definition"
        );

        Ok(property)
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn delete_property_definition(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<(), PropertiesErr> {
        // First check if the property exists and if it's a system property.
        let property = self
            .repository
            .get_property_definition(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::NotFound)?;

        if property.is_system || SystemPropertyKey::is_system_uuid(property_definition_id) {
            return Err(PropertiesErr::SystemPropertyNotModifiable);
        }

        // Then verify ownership.
        self.repository
            .get_property_definition_with_owner(
                property_definition_id,
                user_id,
                team_id_from_receipt(team),
            )
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::NotFound)?;

        self.repository
            .delete_property_definition(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?;

        tracing::info!("successfully deleted property definition");

        Ok(())
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn get_property_options(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<Vec<PropertyOption>, PropertiesErr> {
        let definition = self
            .repository
            .get_property_definition(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::NotFound)?;

        if !definition.is_system {
            self.repository
                .get_property_definition_with_owner(
                    property_definition_id,
                    user_id,
                    team_id_from_receipt(team),
                )
                .await
                .map_err(anyhow::Error::from)?
                .ok_or(PropertiesErr::NotFound)?;
        }

        Ok(self
            .repository
            .get_property_options(property_definition_id)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(skip(self, team, request), fields(request = ?request), err)]
    async fn add_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        property_definition_id: Uuid,
        request: &AddPropertyOptionRequest,
    ) -> Result<PropertyOption, PropertiesErr> {
        let definition = self
            .owned_modifiable_definition(
                property_definition_id,
                user_id,
                team_id_from_receipt(team),
            )
            .await?;

        request
            .validate()
            .map_err(|e| PropertiesErr::Validation(e.to_string()))?;
        request
            .validate_compatibility(&definition.data_type)
            .map_err(|e| PropertiesErr::Validation(e.to_string()))?;

        let (display_order, option_value, color) = match request {
            AddPropertyOptionRequest::SelectString { option } => (
                option.display_order,
                PropertyOptionValue::String(option.value.clone()),
                option.color.clone(),
            ),
            AddPropertyOptionRequest::SelectNumber { option } => (
                option.display_order,
                PropertyOptionValue::Number(option.value),
                None,
            ),
        };

        validate_option_color(&definition.data_type, color.as_deref(), color.as_deref())?;

        let option = self
            .repository
            .create_property_option(property_definition_id, display_order, option_value, color)
            .await
            .map_err(anyhow::Error::from)?;

        tracing::info!(
            option_id = %option.id,
            display_order = option.display_order,
            "successfully added property option"
        );

        Ok(option)
    }

    #[tracing::instrument(skip(self, team, request), fields(request = ?request), err)]
    async fn update_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        property_definition_id: Uuid,
        option_id: Uuid,
        request: &UpdatePropertyOptionRequest,
    ) -> Result<PropertyOption, PropertiesErr> {
        let definition = self
            .owned_modifiable_definition(
                property_definition_id,
                user_id,
                team_id_from_receipt(team),
            )
            .await?;

        let option = self
            .repository
            .get_property_option(option_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::OptionNotFound)?;

        if option.property_definition_id != property_definition_id {
            return Err(PropertiesErr::OptionNotFound);
        }

        let new_value = match &request.value {
            Some(value) => match definition.data_type {
                DataType::SelectString | DataType::Tag => {
                    if value.trim().is_empty() {
                        return Err(PropertiesErr::Validation(
                            "value cannot be empty".to_string(),
                        ));
                    }
                    PropertyOptionValue::String(value.clone())
                }
                _ => {
                    return Err(PropertiesErr::Validation(
                        "value updates are only supported for string and tag options".to_string(),
                    ));
                }
            },
            None => option.value.clone(),
        };

        let new_color = request.color.clone().or_else(|| option.color.clone());
        validate_option_color(
            &definition.data_type,
            request.color.as_deref(),
            new_color.as_deref(),
        )?;

        let new_display_order = request.display_order.unwrap_or(option.display_order);

        match self
            .repository
            .update_property_option(option_id, new_value, new_color, new_display_order)
            .await
            .map_err(anyhow::Error::from)?
        {
            UpdatePropertyOptionOutcome::Updated(updated) => Ok(updated),
            UpdatePropertyOptionOutcome::NotFound => Err(PropertiesErr::OptionNotFound),
            UpdatePropertyOptionOutcome::DuplicateValue => Err(PropertiesErr::DuplicateOptionValue),
        }
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn delete_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> Result<(), PropertiesErr> {
        self.owned_modifiable_definition(
            property_definition_id,
            user_id,
            team_id_from_receipt(team),
        )
        .await?;

        let option = self
            .repository
            .get_property_option(option_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::OptionNotFound)?;

        if option.property_definition_id != property_definition_id {
            return Err(PropertiesErr::OptionNotFound);
        }

        let deleted = self
            .repository
            .delete_property_option(property_definition_id, option_id)
            .await
            .map_err(anyhow::Error::from)?;

        if deleted {
            tracing::info!("successfully deleted property option");
            Ok(())
        } else {
            Err(PropertiesErr::OptionNotFound)
        }
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn list_tag_sets(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<Vec<TagSet>, PropertiesErr> {
        let mut sets = Vec::new();

        let user_definition = self
            .repository
            .get_tag_definition(PropertyDefinitionOwner::User(user_id))
            .await
            .map_err(anyhow::Error::from)?;
        sets.push(self.build_tag_set(TagScope::User, user_definition).await?);

        if let Some(team_id) = team_id_from_receipt(team) {
            let team_definition = self
                .repository
                .get_tag_definition(PropertyDefinitionOwner::Team(team_id))
                .await
                .map_err(anyhow::Error::from)?;
            sets.push(self.build_tag_set(TagScope::Team, team_definition).await?);
        }

        Ok(sets)
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn ensure_tag_set(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        scope: TagScope,
    ) -> Result<TagSet, PropertiesErr> {
        let owner = match scope {
            TagScope::User => PropertyDefinitionOwner::User(user_id),
            TagScope::Team => PropertyDefinitionOwner::Team(
                team_id_from_receipt(team).ok_or(PropertiesErr::TeamMembershipRequired)?,
            ),
        };

        let definition = self
            .repository
            .get_or_create_tag_definition(owner)
            .await
            .map_err(anyhow::Error::from)?;

        self.build_tag_set(scope, Some(definition)).await
    }

    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type()), err)]
    async fn get_entity_properties_with_definitions(
        &self,
        access: &ViewReceipt,
    ) -> Result<Vec<EntityPropertyWithDefinition>, PropertiesErr> {
        let mut properties = self
            .repository
            .get_entity_properties_with_definitions(access.entity_id(), access.entity_type())
            .await
            .map_err(anyhow::Error::from)?;
        retain_caller_visible_tags(&mut properties, access.auth());
        Ok(properties)
    }

    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type()), err)]
    async fn get_entity_metadata_properties(
        &self,
        access: &ViewReceipt,
    ) -> Result<Option<Vec<EntityPropertyWithDefinition>>, PropertiesErr> {
        let entity_id = access.entity_id();
        let properties = match access.entity_type() {
            entity_type @ (EntityType::Document | EntityType::Task) => self
                .repository
                .get_document_metadata(entity_id)
                .await
                .map_err(anyhow::Error::from)?
                .map(|meta| metadata::document_metadata_properties(meta, entity_type)),
            EntityType::Thread => {
                let Ok(thread_id) = Uuid::parse_str(entity_id) else {
                    tracing::error!(entity_id = %entity_id, "invalid thread UUID");
                    return Ok(None);
                };
                self.repository
                    .get_thread_metadata(thread_id)
                    .await
                    .map_err(anyhow::Error::from)?
                    .map(metadata::thread_metadata_properties)
            }
            EntityType::Project => self
                .repository
                .get_project_metadata(entity_id)
                .await
                .map_err(anyhow::Error::from)?
                .map(metadata::project_metadata_properties),
            entity_type => {
                tracing::debug!(
                    entity_type = ?entity_type,
                    "no metadata properties available for this entity type"
                );
                Some(Vec::new())
            }
        };

        Ok(properties)
    }

    #[tracing::instrument(skip(self, access, property_ids), fields(entity_count = access.len(), property_count = property_ids.len()), err)]
    async fn get_bulk_entity_properties(
        &self,
        access: &[ViewReceipt],
        property_ids: Vec<Uuid>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>, PropertiesErr>
    {
        let entity_refs = access
            .iter()
            .map(|receipt| {
                EntityReference::new(receipt.entity_id().to_string(), receipt.entity_type())
            })
            .collect::<Vec<_>>();

        // An empty property_ids means "fetch all properties"; otherwise only
        // the requested definitions are returned.
        let mut result = if property_ids.is_empty() {
            self.repository
                .get_entity_properties_batch(entity_refs)
                .await
                .map_err(anyhow::Error::from)?
        } else {
            self.repository
                .get_entity_properties_batch_filtered(entity_refs, property_ids, None)
                .await
                .map_err(anyhow::Error::from)?
        };

        // Filter each entity's properties by the auth of the receipt that
        // granted access to that entity, so personal tags stay private.
        let auth_by_key: HashMap<EntityPropertiesKey, &ViewReceipt> = access
            .iter()
            .map(|receipt| {
                (
                    EntityPropertiesKey {
                        entity_id: receipt.entity_id().to_string(),
                        entity_type: receipt.entity_type(),
                    },
                    receipt,
                )
            })
            .collect();
        for (key, properties) in result.iter_mut() {
            if let Some(receipt) = auth_by_key.get(key) {
                retain_caller_visible_tags(properties, receipt.auth());
            }
        }

        Ok(result)
    }

    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type()), err)]
    async fn delete_entity_properties(&self, access: &EditReceipt) -> Result<(), PropertiesErr> {
        let entity_reference =
            EntityReference::new(access.entity_id().to_string(), access.entity_type());
        Ok(self
            .repository
            .delete_entity_properties(&entity_reference)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(skip(self), fields(entity_property_id = %entity_property_id), err)]
    async fn lookup_entity_property(
        &self,
        entity_property_id: Uuid,
    ) -> Result<Option<EntityPropertyReference>, PropertiesErr> {
        Ok(self
            .repository
            .lookup_entity_property(entity_property_id)
            .await
            .map_err(anyhow::Error::from)?)
    }

    #[tracing::instrument(skip(self, access), fields(entity_property_id = %entity_property_id, entity_id = %access.entity_id()), err)]
    async fn delete_entity_property(
        &self,
        access: &EditReceipt,
        entity_property_id: Uuid,
    ) -> Result<(), PropertiesErr> {
        let property_info = self
            .repository
            .lookup_entity_property(entity_property_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::EntityPropertyNotFound)?;

        // The receipt must prove access to the entity this property is
        // actually attached to - a receipt for another entity is no proof.
        if property_info.entity_id != access.entity_id()
            || property_info.entity_type != access.entity_type()
        {
            tracing::warn!(
                receipt_entity_id = %access.entity_id(),
                property_entity_id = %property_info.entity_id,
                "receipt entity does not match the entity the property is attached to"
            );
            return Err(PropertiesErr::PermissionDenied);
        }

        // Check if this property is required for the entity type (e.g., Task properties)
        if SystemPropertyKey::is_required_for_entity(
            property_info.property_definition_id,
            property_info.entity_type,
        ) {
            tracing::warn!(
                entity_type = ?property_info.entity_type,
                property_definition_id = %property_info.property_definition_id,
                "attempted to remove required property"
            );
            return Err(PropertiesErr::RequiredProperty);
        }

        self.repository
            .delete_entity_property(entity_property_id)
            .await
            .map_err(anyhow::Error::from)?;

        tracing::info!("successfully removed entity property");

        Ok(())
    }
}

/// Validate the color rules for a property option: colors are only supported
/// on tag options (as hex strings), and tag options must end up with a color.
/// `provided_color` is the color supplied in the request; `effective_color` is
/// the color the option would have after the operation.
fn validate_option_color(
    data_type: &DataType,
    provided_color: Option<&str>,
    effective_color: Option<&str>,
) -> Result<(), PropertiesErr> {
    if provided_color.is_some() && *data_type != DataType::Tag {
        return Err(PropertiesErr::Validation(
            "color is only supported on tag options".to_string(),
        ));
    }
    if let Some(color) = provided_color
        && !is_valid_hex_color(color)
    {
        return Err(PropertiesErr::Validation(
            "color must be a hex string like #RRGGBB".to_string(),
        ));
    }
    if *data_type == DataType::Tag && effective_color.is_none() {
        return Err(PropertiesErr::Validation(
            "tag options require a color".to_string(),
        ));
    }
    Ok(())
}

/// Build a [`PropertyOption`] for creation. IDs and timestamps are placeholders
/// replaced by the database on insert.
fn build_property_option(display_order: i32, value: PropertyOptionValue) -> PropertyOption {
    PropertyOption {
        id: Uuid::nil(),                     // Temporary ID, will be replaced by DB
        property_definition_id: Uuid::nil(), // Temporary ID, will be replaced by DB
        display_order,
        value,
        color: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}
