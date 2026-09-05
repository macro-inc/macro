//! Service implementation for properties.

mod helpers;
mod task_properties;

use std::collections::{HashMap, HashSet};

use activity::Actor;
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{
    BotReceiptScope, EntityAccessAuth, EntityAccessReceipt, EntityType as AccessEntityType,
    RequiredPermission,
};
use macro_event_broker::{MacroEventBroker, NoopMacroEventBroker};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::DataType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::api::{
    AddPropertyOptionRequest, CreatePropertyDefinitionRequest, CreatePropertyScope,
    PropertyDataType, UpdatePropertyOptionRequest, is_valid_hex_color,
};
use models_properties::convert_set_property_value_to_property_value;
use models_properties::service::entity_property::EntityProperty;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use super::error::PropertiesErr;
use super::events::{
    EntityPropertiesClearedMetadata, EntityPropertyDeletedMetadata, EntityPropertyUpdatedMetadata,
    PropertyCreatedMetadata, PropertyDeletedMetadata, PropertyMacroEvent,
    PropertyOptionCreatedMetadata, PropertyOptionDeletedMetadata, PropertyOptionUpdatedMetadata,
};
use super::metadata;
use super::model::{
    EditReceipt, EntityOptionUpdateOutcome, EntityPropertyInfo, EntityPropertyOptionSelection,
    EntityPropertyOptionUpdate, PropertyAccessReceiptExt, PropertyDefinitionOwner,
    PropertyTargetKey, ResolvedPropertySubject, TagPromotionOutcome, TagRemapOutcome, TagScope,
    TagSet, UpdatePropertyOptionOutcome, ViewReceipt,
};
use super::ports::{NotificationService, PermissionService, PropertiesRepo};
use super::service::{PropertiesService, TeamReceipt, team_id_from_receipt};

use helpers::{
    extract_option_ids_from_property_value, is_property_applicable_to, retain_caller_visible_tags,
};

struct PublishedEventActors {
    actor: Option<Actor<'static>>,
    on_behalf_of: Option<MacroUserIdStr<'static>>,
    actor_user_id: Option<MacroUserIdStr<'static>>,
}

fn published_event_actors(access: &EditReceipt) -> PublishedEventActors {
    match access.auth() {
        EntityAccessAuth::Authenticated(user) => PublishedEventActors {
            actor: None,
            on_behalf_of: None,
            actor_user_id: Some(user.clone()),
        },
        EntityAccessAuth::Bot(bot) => match bot.scope() {
            BotReceiptScope::User { acting_user } => PublishedEventActors {
                actor: Some(Actor::new_from_bot(bot.bot_id())),
                on_behalf_of: Some(acting_user.clone()),
                actor_user_id: None,
            },
            BotReceiptScope::Team { .. } => PublishedEventActors {
                actor: None,
                on_behalf_of: None,
                actor_user_id: None,
            },
        },
        EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => PublishedEventActors {
            actor: None,
            on_behalf_of: None,
            actor_user_id: None,
        },
    }
}

/// Implementation of [`PropertiesService`] using repository, permission,
/// notification, and event-publishing ports.
#[derive(Debug)]
pub struct PropertiesServiceImpl<R, P, N, B = NoopMacroEventBroker>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    B: MacroEventBroker,
{
    repository: R,
    permission_service: Option<P>,
    notification_service: Option<N>,
    event_broker: B,
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
            event_broker: NoopMacroEventBroker,
        }
    }
}

impl<R, P, N, B> PropertiesServiceImpl<R, P, N, B>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    B: MacroEventBroker,
{
    /// Replace the event broker while preserving every other service dependency.
    pub fn with_event_broker<B2: MacroEventBroker>(
        self,
        event_broker: B2,
    ) -> PropertiesServiceImpl<R, P, N, B2> {
        PropertiesServiceImpl {
            repository: self.repository,
            permission_service: self.permission_service,
            notification_service: self.notification_service,
            event_broker,
        }
    }

    /// Publish a property lifecycle event without coupling broker availability
    /// to a completed mutation.
    fn publish_property_event(&self, event: PropertyMacroEvent) {
        drop(self.event_broker.send_event(&event).inspect_err(|error| {
            tracing::error!(error = ?error, "failed to schedule property event");
        }));
    }

    /// Build a creation event from the authoritative persisted definition.
    fn property_created_event(
        property: &PropertyDefinition,
        actor_user_id: &MacroUserIdStr<'_>,
    ) -> PropertyMacroEvent {
        PropertyMacroEvent::created(PropertyCreatedMetadata {
            property_definition_id: property.id,
            actor_user_id: Some(actor_user_id.clone().into_owned()),
            owner: property.owner.clone(),
            display_name: property.display_name.clone(),
            data_type: property.data_type,
            is_multi_select: property.is_multi_select,
            specific_entity_type: property.specific_entity_type,
            created_at: property.created_at,
        })
    }

    /// Build an option creation event from the authoritative persisted state.
    fn property_option_created_event(
        option: &PropertyOption,
        actor_user_id: &MacroUserIdStr<'_>,
    ) -> PropertyMacroEvent {
        PropertyMacroEvent::property_option_created(PropertyOptionCreatedMetadata {
            option_id: option.id,
            property_definition_id: option.property_definition_id,
            actor_user_id: Some(actor_user_id.clone().into_owned()),
            value: option.value.clone(),
            color: option.color.clone(),
            display_order: option.display_order,
        })
    }

    /// Build an option update event from the authoritative post-update state.
    fn property_option_updated_event(
        option: &PropertyOption,
        actor_user_id: &MacroUserIdStr<'_>,
    ) -> PropertyMacroEvent {
        PropertyMacroEvent::property_option_updated(PropertyOptionUpdatedMetadata {
            option_id: option.id,
            property_definition_id: option.property_definition_id,
            actor_user_id: Some(actor_user_id.clone().into_owned()),
            value: option.value.clone(),
            color: option.color.clone(),
            display_order: option.display_order,
        })
    }

    /// Build an option deletion event from the value captured before deletion.
    fn property_option_deleted_event(
        option: &PropertyOption,
        actor_user_id: &MacroUserIdStr<'_>,
    ) -> PropertyMacroEvent {
        PropertyMacroEvent::property_option_deleted(PropertyOptionDeletedMetadata {
            option_id: option.id,
            property_definition_id: option.property_definition_id,
            actor_user_id: Some(actor_user_id.clone().into_owned()),
            value: option.value.clone(),
        })
    }

    /// Build an entity-property update event from committed persistence state.
    fn entity_property_updated_event(
        property: &EntityProperty,
        value: &Option<PropertyValue>,
        previous_value: &Option<PropertyValue>,
        access: &EditReceipt,
    ) -> PropertyMacroEvent {
        let PublishedEventActors {
            actor,
            on_behalf_of,
            actor_user_id,
        } = published_event_actors(access);
        PropertyMacroEvent::entity_property_updated(EntityPropertyUpdatedMetadata {
            entity_property_id: property.id,
            entity_id: property.entity_id.clone(),
            entity_type: property.entity_type,
            property_definition_id: property.property_definition_id,
            actor_user_id,
            actor,
            on_behalf_of,
            value: value.clone(),
            previous_value: previous_value.clone(),
            updated_at: property.updated_at,
        })
    }

    /// Publish each authoritative mutation returned by a bulk transaction.
    fn publish_entity_property_selection_events(
        &self,
        selections: &[EntityPropertyOptionSelection],
        access: &EditReceipt,
    ) {
        for mutation in selections
            .iter()
            .filter_map(|selection| selection.mutation.as_ref())
        {
            self.publish_property_event(Self::entity_property_updated_event(
                &mutation.property,
                &mutation.value,
                &mutation.previous_value,
                access,
            ));
        }
    }

    /// The permission service, or the error every receipt-minting path maps a
    /// missing one to.
    fn permission_service(&self) -> Result<&P, PropertiesErr> {
        self.permission_service
            .as_ref()
            .ok_or(PropertiesErr::PermissionServiceNotConfigured)
    }

    /// Resolve canonical access receipts to internal properties storage keys.
    async fn resolve_subjects<T: RequiredPermission>(
        &self,
        access: &[EntityAccessReceipt<T>],
    ) -> Result<Vec<ResolvedPropertySubject>, PropertiesErr>
    where
        anyhow::Error: From<R::Err>,
    {
        let document_ids = access
            .iter()
            .filter(|receipt| receipt.entity_type() == AccessEntityType::Document)
            .filter_map(|receipt| Uuid::parse_str(receipt.entity_id()).ok())
            .collect::<HashSet<_>>();

        let document_sub_types = if document_ids.is_empty() {
            HashMap::new()
        } else {
            self.repository
                .get_document_sub_types(&document_ids.into_iter().collect::<Vec<_>>())
                .await
                .map_err(anyhow::Error::from)?
        };

        access
            .iter()
            .map(|receipt| {
                let canonical_entity_type = receipt.entity_type();
                let storage_entity_type = match canonical_entity_type {
                    AccessEntityType::Document => Uuid::parse_str(receipt.entity_id())
                        .ok()
                        .and_then(|document_id| document_sub_types.get(&document_id))
                        .map_or(EntityType::Document, |sub_type| match sub_type {
                            DocumentSubType::Task => EntityType::Task,
                            DocumentSubType::Snippet | DocumentSubType::Skill => {
                                EntityType::Document
                            }
                        }),
                    other => super::model::storage_entity_type(other).ok_or_else(|| {
                        PropertiesErr::Validation(format!(
                            "Unsupported property target type: {other}"
                        ))
                    })?,
                };

                Ok(ResolvedPropertySubject {
                    canonical_key: PropertyTargetKey {
                        entity_id: receipt.entity_id().to_string(),
                        entity_type: canonical_entity_type,
                    },
                    storage_entity_type,
                })
            })
            .collect()
    }

    /// Resolve one canonical access receipt to its internal storage key.
    async fn resolve_subject<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
    ) -> Result<ResolvedPropertySubject, PropertiesErr>
    where
        anyhow::Error: From<R::Err>,
    {
        self.resolve_subjects(std::slice::from_ref(access))
            .await?
            .pop()
            .ok_or_else(|| PropertiesErr::Validation("Missing property target".to_string()))
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

    /// Resolve the personal tag definition that owns `option_id`, rejecting
    /// options the caller does not own and options that are not labels.
    async fn owned_personal_tag_option(
        &self,
        option_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(PropertyOption, PropertyDefinition), PropertiesErr>
    where
        anyhow::Error: From<R::Err>,
    {
        let option = self
            .repository
            .get_property_option(option_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::OptionNotFound)?;

        let definition = self
            .repository
            .get_tag_definition(PropertyDefinitionOwner::User(user_id))
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::OptionNotFound)?;

        if option.property_definition_id != definition.id {
            return Err(PropertiesErr::OptionNotFound);
        }

        Ok((option, definition))
    }

    /// Provision the team tag set the caller is sharing a label into.
    async fn target_team_tag_definition(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<PropertyDefinition, PropertiesErr>
    where
        anyhow::Error: From<R::Err>,
    {
        let team_id = team_id_from_receipt(team).ok_or(PropertiesErr::TeamMembershipRequired)?;
        let result = self
            .repository
            .get_or_create_tag_definition(PropertyDefinitionOwner::Team(team_id))
            .await
            .map_err(anyhow::Error::from)?;

        if result.created {
            self.publish_property_event(Self::property_created_event(&result.definition, user_id));
        }

        Ok(result.definition)
    }

    /// Publish one entity-property event per entity the remap rewrote, so the
    /// search index and Soup rebuild those entities from the committed rows.
    fn publish_tag_remap_events(&self, remap: &TagRemapOutcome, actor: &MacroUserIdStr<'_>) {
        for mutation in &remap.mutations {
            self.publish_property_event(PropertyMacroEvent::entity_property_updated(
                EntityPropertyUpdatedMetadata {
                    entity_property_id: mutation.property.id,
                    entity_id: mutation.property.entity_id.clone(),
                    entity_type: mutation.property.entity_type,
                    property_definition_id: mutation.property.property_definition_id,
                    actor_user_id: Some(actor.clone().into_owned()),
                    actor: None,
                    on_behalf_of: None,
                    value: mutation.value.clone(),
                    previous_value: mutation.previous_value.clone(),
                    updated_at: mutation.property.updated_at,
                },
            ));
        }
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

impl<R, P, N, B> PropertiesService for PropertiesServiceImpl<R, P, N, B>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    B: MacroEventBroker,
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
        let subject = self.resolve_subject(access).await?;
        let tag_viewer_user_id = access
            .authenticated_user()
            .map(|user| user.as_ref())
            .unwrap_or_default();
        Ok(self
            .repository
            .get_entity_properties(
                access.entity_id(),
                subject.storage_entity_type,
                tag_viewer_user_id,
            )
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
        let subject = self.resolve_subject(access).await?;
        Ok(self
            .repository
            .get_entity_property_value(
                access.entity_id(),
                subject.storage_entity_type,
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
        let subject = self.resolve_subject(access).await?;
        let entity_id = access.entity_id();
        let entity_type = subject.storage_entity_type;

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
            self.publish_property_event(Self::entity_property_updated_event(
                &property,
                &property_value,
                // The relationship transaction doesn't capture the pre-write
                // value; the activity transition simply omits its "from" side.
                &None,
                access,
            ));
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
            self.handle_task_assignees_property(entity_id, value, access.acting_user_id())
                .await?;
        }

        let snapshot = self
            .repository
            .upsert_entity_property(
                entity_id,
                entity_type,
                property_definition_id,
                property_value.clone(),
            )
            .await
            .map_err(anyhow::Error::from)?;

        self.publish_property_event(Self::entity_property_updated_event(
            &snapshot.property,
            &property_value,
            &snapshot.previous_value,
            access,
        ));

        Ok(EntityPropertyWithDefinition {
            property: snapshot.property,
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

        let subject = self.resolve_subject(access).await?;
        if !is_property_applicable_to(property_definition_id, subject.storage_entity_type) {
            return Err(PropertiesErr::Validation(
                "This property cannot be attached to this entity type".to_string(),
            ));
        }

        self.validate_property_options(property_definition_id, &[option_id])
            .await?;

        let mutation = self
            .repository
            .add_entity_property_option(
                access.entity_id(),
                subject.storage_entity_type,
                property_definition_id,
                option_id,
            )
            .await
            .map_err(anyhow::Error::from)?;

        self.publish_property_event(Self::entity_property_updated_event(
            &mutation.property,
            &mutation.value,
            &mutation.previous_value,
            access,
        ));

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
        let subject = self.resolve_subject(access).await?;
        let mutation = self
            .repository
            .remove_entity_property_option(
                access.entity_id(),
                subject.storage_entity_type,
                property_definition_id,
                option_id,
            )
            .await
            .map_err(anyhow::Error::from)?;

        if let Some(mutation) = mutation {
            self.publish_property_event(Self::entity_property_updated_event(
                &mutation.property,
                &mutation.value,
                &mutation.previous_value,
                access,
            ));
        }

        Ok(())
    }

    #[tracing::instrument(
        skip(self, access, updates),
        fields(
            entity_id = %access.entity_id(),
            entity_type = ?access.entity_type(),
            property_count = updates.len()
        ),
        err
    )]
    async fn bulk_update_entity_property_options(
        &self,
        access: &EditReceipt,
        updates: Vec<EntityPropertyOptionUpdate>,
    ) -> Result<Vec<EntityPropertyOptionSelection>, PropertiesErr> {
        let subject = self.resolve_subject(access).await?;
        let entity_type = subject.storage_entity_type;

        // Validate every property up front so an invalid option never triggers a
        // partial write: the persistence below is a single transaction and only
        // runs once all properties pass.
        for update in &updates {
            let property_definition = self
                .repository
                .get_property_definition(update.property_definition_id)
                .await
                .map_err(anyhow::Error::from)?
                .ok_or_else(|| {
                    PropertiesErr::Validation(format!(
                        "Property definition not found: {}",
                        update.property_definition_id
                    ))
                })?;

            if !property_definition.is_multi_select {
                return Err(PropertiesErr::Validation(
                    "Option add/remove is only supported for multi-select properties".to_string(),
                ));
            }

            if !is_property_applicable_to(update.property_definition_id, entity_type) {
                return Err(PropertiesErr::Validation(
                    "This property cannot be attached to this entity type".to_string(),
                ));
            }

            // Only additions need option validation; removing an id that is not a
            // valid option is a harmless no-op. Dedupe first so an accidentally
            // repeated id is not miscounted as an invalid one.
            let mut add_option_ids = update.add_option_ids.clone();
            add_option_ids.sort();
            add_option_ids.dedup();
            self.validate_property_options(update.property_definition_id, &add_option_ids)
                .await?;
        }

        let selections = self
            .repository
            .bulk_update_entity_property_options(access.entity_id(), entity_type, &updates)
            .await
            .map_err(anyhow::Error::from)?;

        self.publish_entity_property_selection_events(&selections, access);

        Ok(selections)
    }

    #[tracing::instrument(
        skip(self, access, add_option_ids, remove_option_ids),
        fields(
            entity_count = access.len(),
            property_definition_id = %property_definition_id,
            add_count = add_option_ids.len(),
            remove_count = remove_option_ids.len(),
        ),
        err
    )]
    async fn bulk_update_entities_property_options(
        &self,
        access: &[EditReceipt],
        property_definition_id: Uuid,
        add_option_ids: Vec<Uuid>,
        remove_option_ids: Vec<Uuid>,
    ) -> Result<Vec<EntityOptionUpdateOutcome>, PropertiesErr> {
        // Validate the shared delta once. A missing property, a single-select
        // property, or an invalid added option is a client error in the request
        // itself, so it fails the whole call rather than producing per-entity
        // failures.
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

        // Only additions need option validation; removing an unknown id is a
        // harmless no-op. Dedupe first so a repeated id is not miscounted.
        let mut validated_add_ids = add_option_ids.clone();
        validated_add_ids.sort();
        validated_add_ids.dedup();
        self.validate_property_options(property_definition_id, &validated_add_ids)
            .await?;

        // Resolve every subject in one batch (one document-subtype lookup).
        let subjects = self.resolve_subjects(access).await?;

        let update = EntityPropertyOptionUpdate {
            property_definition_id,
            add_option_ids,
            remove_option_ids,
        };

        // Acquire per-entity row locks in a consistent order across callers so
        // two cross-entity updates touching overlapping entities can't deadlock.
        // Each entity is its own transaction, so outcomes are still returned
        // aligned to the input order.
        let mut order: Vec<usize> = (0..subjects.len()).collect();
        order.sort_by_key(|&index| {
            (
                subjects[index].canonical_key.entity_id.clone(),
                format!("{:?}", subjects[index].storage_entity_type),
            )
        });

        let mut outcomes: Vec<Option<EntityOptionUpdateOutcome>> =
            (0..subjects.len()).map(|_| None).collect();
        for index in order {
            let subject = &subjects[index];
            let entity_id = subject.canonical_key.entity_id.as_str();
            let entity_type = subject.storage_entity_type;

            if !is_property_applicable_to(property_definition_id, entity_type) {
                outcomes[index] = Some(EntityOptionUpdateOutcome::Failed {
                    message: "This property cannot be attached to this entity type".to_string(),
                });
                continue;
            }

            let update_result = self
                .repository
                .bulk_update_entity_property_options(
                    entity_id,
                    entity_type,
                    std::slice::from_ref(&update),
                )
                .await
                .map_err(anyhow::Error::from);

            match update_result {
                Ok(selections) => {
                    let option_ids = selections
                        .last()
                        .map(|selection| selection.option_ids.clone())
                        .unwrap_or_default();
                    self.publish_entity_property_selection_events(&selections, &access[index]);
                    outcomes[index] = Some(EntityOptionUpdateOutcome::Applied { option_ids });
                }
                Err(error) => {
                    tracing::warn!(
                        error = ?error,
                        entity_id = %entity_id,
                        "failed to apply bulk option delta to entity"
                    );
                    outcomes[index] = Some(EntityOptionUpdateOutcome::Failed {
                        message: error.to_string(),
                    });
                }
            }
        }

        Ok(outcomes
            .into_iter()
            .map(|outcome| outcome.expect("every subject yields an outcome"))
            .collect())
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn get_property_definition(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<PropertyDefinition, PropertiesErr> {
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

        Ok(definition)
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

        self.publish_property_event(Self::property_created_event(&property, user_id));

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

        self.publish_property_event(PropertyMacroEvent::deleted(PropertyDeletedMetadata {
            property_definition_id: property.id,
            actor_user_id: Some(user_id.clone().into_owned()),
            owner: property.owner,
            display_name: property.display_name,
            data_type: property.data_type,
        }));

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

        self.publish_property_event(Self::property_option_created_event(&option, user_id));

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
            UpdatePropertyOptionOutcome::Updated(updated) => {
                self.publish_property_event(Self::property_option_updated_event(&updated, user_id));
                Ok(updated)
            }
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

        if !deleted {
            return Err(PropertiesErr::OptionNotFound);
        }

        tracing::info!("successfully deleted property option");
        self.publish_property_event(Self::property_option_deleted_event(&option, user_id));

        Ok(())
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

        let result = self
            .repository
            .get_or_create_tag_definition(owner)
            .await
            .map_err(anyhow::Error::from)?;

        if result.created {
            self.publish_property_event(Self::property_created_event(&result.definition, user_id));
        }

        self.build_tag_set(scope, Some(result.definition)).await
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn promote_tag_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        option_id: Uuid,
    ) -> Result<PropertyOption, PropertiesErr> {
        let (_, source_definition) = self.owned_personal_tag_option(option_id, user_id).await?;
        let target_definition = self.target_team_tag_definition(user_id, team).await?;

        let outcome = self
            .repository
            .promote_tag_option(option_id, source_definition.id, target_definition.id)
            .await
            .map_err(anyhow::Error::from)?;

        let remap = match outcome {
            TagPromotionOutcome::Promoted(remap) => remap,
            TagPromotionOutcome::Conflict(conflict) => {
                tracing::info!(
                    conflicting_option_id = %conflict.id,
                    "team already has a label with that name"
                );
                return Err(PropertiesErr::ConflictingTeamLabel(Box::new(conflict)));
            }
        };

        tracing::info!(
            entities_retagged = remap.mutations.len(),
            "promoted personal label to the team tag set"
        );

        // The option keeps its id, so this reports the same label now hanging
        // off the team definition rather than a newly created one.
        self.publish_property_event(Self::property_option_updated_event(&remap.option, user_id));
        self.publish_tag_remap_events(&remap, user_id);

        Ok(remap.option)
    }

    #[tracing::instrument(skip(self, team), err)]
    async fn merge_tag_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        option_id: Uuid,
        target_option_id: Uuid,
    ) -> Result<PropertyOption, PropertiesErr> {
        if option_id == target_option_id {
            return Err(PropertiesErr::Validation(
                "cannot merge a label into itself".to_string(),
            ));
        }

        let (source_option, source_definition) =
            self.owned_personal_tag_option(option_id, user_id).await?;
        let target_definition = self.target_team_tag_definition(user_id, team).await?;

        let remap = self
            .repository
            .merge_tag_option(
                option_id,
                source_definition.id,
                target_option_id,
                target_definition.id,
            )
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PropertiesErr::OptionNotFound)?;

        tracing::info!(
            entities_retagged = remap.mutations.len(),
            "merged personal label into an existing team label"
        );

        self.publish_property_event(Self::property_option_deleted_event(&source_option, user_id));
        self.publish_tag_remap_events(&remap, user_id);

        Ok(remap.option)
    }

    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type()), err)]
    async fn get_entity_properties_with_definitions(
        &self,
        access: &ViewReceipt,
    ) -> Result<Vec<EntityPropertyWithDefinition>, PropertiesErr> {
        let subject = self.resolve_subject(access).await?;
        let mut properties = self
            .repository
            .get_entity_properties_with_definitions(access.entity_id(), subject.storage_entity_type)
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
        let subject = self.resolve_subject(access).await?;
        let entity_id = access.entity_id();
        let properties = match subject.storage_entity_type {
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
    ) -> Result<HashMap<PropertyTargetKey, Vec<EntityPropertyWithDefinition>>, PropertiesErr> {
        let subjects = self.resolve_subjects(access).await?;
        let entity_refs = subjects
            .iter()
            .map(|subject| {
                EntityReference::new(
                    subject.canonical_key.entity_id.clone(),
                    subject.storage_entity_type,
                )
            })
            .collect::<Vec<_>>();

        // An empty property_ids means "fetch all properties"; otherwise only
        // the requested definitions are returned.
        let mut internal_result = if property_ids.is_empty() {
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

        // Return canonical keys while preserving the internal key only at the
        // repository boundary. Filter personal tags using the receipt that
        // granted access to each canonical entity.
        let mut result = HashMap::with_capacity(subjects.len());
        for (subject, receipt) in subjects.into_iter().zip(access) {
            if result.contains_key(&subject.canonical_key) {
                continue;
            }
            let mut properties = internal_result
                .remove(&subject.storage_key())
                .unwrap_or_default();
            retain_caller_visible_tags(&mut properties, receipt.auth());
            result.insert(subject.canonical_key, properties);
        }

        Ok(result)
    }

    #[tracing::instrument(skip(self, access), fields(entity_id = %access.entity_id(), entity_type = ?access.entity_type()), err)]
    async fn delete_entity_properties(&self, access: &EditReceipt) -> Result<(), PropertiesErr> {
        let subject = self.resolve_subject(access).await?;
        let entity_reference =
            EntityReference::new(access.entity_id().to_string(), subject.storage_entity_type);
        self.repository
            .delete_entity_properties(&entity_reference)
            .await
            .map_err(anyhow::Error::from)?;

        let PublishedEventActors {
            actor,
            on_behalf_of,
            actor_user_id,
        } = published_event_actors(access);
        self.publish_property_event(PropertyMacroEvent::entity_properties_cleared(
            EntityPropertiesClearedMetadata {
                entity_id: access.entity_id().to_string(),
                entity_type: subject.storage_entity_type,
                actor_user_id,
                actor,
                on_behalf_of,
            },
        ));

        Ok(())
    }

    #[tracing::instrument(skip(self), fields(entity_property_id = %entity_property_id), err)]
    async fn lookup_entity_property(
        &self,
        entity_property_id: Uuid,
    ) -> Result<Option<PropertyTargetKey>, PropertiesErr> {
        Ok(self
            .repository
            .lookup_entity_property(entity_property_id)
            .await
            .map_err(anyhow::Error::from)?
            .map(|property| PropertyTargetKey {
                entity_id: property.entity_id,
                entity_type: super::model::canonical_entity_type(property.entity_type),
            }))
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

        let subject = self.resolve_subject(access).await?;

        // The receipt must prove access to the canonical entity this property
        // is attached to. A stored Task assignment belongs to a Document
        // receipt after subtype resolution.
        if property_info.entity_id != access.entity_id()
            || property_info.entity_type != subject.storage_entity_type
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

        let PublishedEventActors {
            actor,
            on_behalf_of,
            actor_user_id,
        } = published_event_actors(access);
        self.publish_property_event(PropertyMacroEvent::entity_property_deleted(
            EntityPropertyDeletedMetadata {
                entity_property_id,
                entity_id: property_info.entity_id,
                entity_type: property_info.entity_type,
                property_definition_id: property_info.property_definition_id,
                actor_user_id,
                actor,
                on_behalf_of,
            },
        ));

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
