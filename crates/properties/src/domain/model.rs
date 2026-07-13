//! Domain models for properties.

use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    EntityType as AccessEntityType, RequiredPermission, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityReference, EntityType, PropertyOwner};
use uuid::Uuid;

/// Map a properties entity type onto the entity type used by the access
/// control system. Tasks are stored as documents, so the mapping collapses
/// Task into Document; [`PropertiesAccessReceipt`] preserves the original type.
pub fn access_entity_type(entity_type: EntityType) -> AccessEntityType {
    match entity_type {
        EntityType::Document => AccessEntityType::Document,
        EntityType::Chat => AccessEntityType::Chat,
        EntityType::Project => AccessEntityType::Project,
        EntityType::Thread => AccessEntityType::EmailThread,
        EntityType::Channel => AccessEntityType::Channel,
        // Tasks are stored as documents, so they share document permissions.
        EntityType::Task => AccessEntityType::Document,
        // CRM company access is resolved from the owning team's membership.
        EntityType::Company => AccessEntityType::CrmCompany,
        EntityType::User => AccessEntityType::User,
    }
}

/// Proof that a caller holds (at least) permission `T` on one entity.
///
/// Wraps the [`EntityAccessReceipt`] minted by the permission adapter together
/// with the original properties entity type, which the access-control mapping
/// loses (Task maps to Document). Every entity-scoped
/// [`PropertiesService`](super::service::PropertiesService) method takes one of
/// these, so an unchecked call cannot compile.
#[derive(Debug, Clone)]
pub struct PropertiesAccessReceipt<T: RequiredPermission> {
    receipt: EntityAccessReceipt<T>,
    entity_id: String,
    entity_type: EntityType,
}

/// Proof of view (or better) access to one entity.
pub type ViewReceipt = PropertiesAccessReceipt<ViewAccessLevel>;
/// Proof of edit (or better) access to one entity.
pub type EditReceipt = PropertiesAccessReceipt<EditAccessLevel>;

impl<T: RequiredPermission> PropertiesAccessReceipt<T> {
    /// Wrap a receipt minted by the entity access service while preserving the
    /// original properties entity type (notably, tasks map to documents in the
    /// access service).
    pub fn try_from_entity_access_receipt(
        receipt: EntityAccessReceipt<T>,
        entity_type: EntityType,
    ) -> Result<Self, entity_access::domain::models::AccessError> {
        if receipt.entity().entity_type != access_entity_type(entity_type) {
            return Err(entity_access::domain::models::AccessError::BadRequest(
                "entity access receipt type does not match properties entity type",
            ));
        }

        let entity_id = receipt.entity().entity_id.clone();
        Ok(Self {
            receipt,
            entity_id,
            entity_type,
        })
    }

    /// The entity this receipt grants access to.
    pub fn entity_id(&self) -> &str {
        &self.entity_id
    }

    /// The properties entity type this receipt grants access to.
    pub fn entity_type(&self) -> EntityType {
        self.entity_type
    }

    /// How the caller was authenticated.
    pub fn auth(&self) -> &EntityAccessAuth {
        self.receipt.auth()
    }

    /// The authenticated user this receipt was minted for, if any
    /// (`None` for internal and anonymous-public access).
    pub fn authenticated_user(&self) -> Option<&MacroUserIdStr<'static>> {
        match self.receipt.auth() {
            EntityAccessAuth::Authenticated(user) => Some(user),
            EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => None,
        }
    }

    /// Dangerously mint a receipt for an internal (service-to-service or
    /// worker) caller without an access check.
    /// **NOTE** Use only for machine flows that operate outside a user
    /// session; never to bypass a user's permission check.
    pub fn dangerously_assert_internal(entity_id: &str, entity_type: EntityType) -> Self {
        Self {
            receipt: EntityAccessReceipt::dangerously_assert_internal_user(
                entity_id,
                access_entity_type(entity_type),
            ),
            entity_id: entity_id.to_string(),
            entity_type,
        }
    }

    /// Dangerously mint a receipt for an authenticated user without the
    /// underlying access check. **NOTE** Intended for tests, and for callers
    /// that have already verified the user's access to the entity through
    /// another authoritative seam (e.g. a CRM team-scoped listing) — never as
    /// a way to skip a check that hasn't happened.
    pub fn dangerously_assert_authenticated_user(
        user_id: MacroUserIdStr<'static>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Self {
        Self {
            receipt: EntityAccessReceipt::dangerously_assert_authenticated_user(
                user_id,
                entity_id,
                access_entity_type(entity_type),
            ),
            entity_id: entity_id.to_string(),
            entity_type,
        }
    }

    /// Mint a receipt from a resolved permission, validating it satisfies `T`.
    /// Only the permission adapter constructs these.
    pub(crate) fn try_from_permission(
        auth: EntityAccessAuth,
        entity_id: &str,
        entity_type: EntityType,
        access_level: AccessLevel,
    ) -> Result<Self, entity_access::domain::models::AccessError> {
        let receipt = EntityAccessReceipt::try_new(
            auth,
            Entity {
                entity_id: entity_id.to_string(),
                entity_type: access_entity_type(entity_type),
            },
            EntityPermission::AccessLevel { access_level },
        )?;
        Self::try_from_entity_access_receipt(receipt, entity_type)
    }
}

/// Key identifying the properties attached to one entity.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EntityPropertiesKey {
    pub entity_id: String,
    pub entity_type: EntityType,
}

impl From<&EntityReference> for EntityPropertiesKey {
    fn from(value: &EntityReference) -> Self {
        Self {
            entity_id: value.entity_id.clone(),
            entity_type: value.entity_type,
        }
    }
}

/// Summary of a property attached to an entity, including its definition and current value.
#[derive(Debug, Clone)]
pub struct EntityPropertyInfo {
    /// The property definition ID (used to set values via `set_entity_property`).
    pub property_definition_id: Uuid,
    /// Who owns the property definition (user, team, or system).
    pub owner: PropertyOwner,
    /// Human-readable name of the property.
    pub display_name: String,
    /// The data type of the property.
    pub data_type: DataType,
    /// Whether the property supports multiple values.
    pub is_multi_select: bool,
    /// Whether this is a system-defined property.
    pub is_system: bool,
    /// The current value of the property, if set.
    pub value: Option<PropertyValue>,
    /// Available options for select-type properties.
    pub options: Vec<PropertyOptionInfo>,
}

/// A selectable option for select-type properties.
#[derive(Debug, Clone)]
pub struct PropertyOptionInfo {
    /// The option ID (used when setting select values).
    pub id: Uuid,
    /// Display order for UI rendering.
    pub display_order: i32,
    /// The option's value.
    pub value: PropertyOptionValue,
}

/// The owner of a user- or team-created property definition. Encodes the
/// "exactly one of user / team" invariant in the type, so neither a both-owners
/// nor a no-owner row is representable. System properties are not created here.
#[derive(Debug, Clone, Copy)]
pub enum PropertyDefinitionOwner<'a> {
    /// Owned by a single user.
    User(&'a MacroUserIdStr<'a>),
    /// Owned by a team.
    Team(Uuid),
}

impl<'a> PropertyDefinitionOwner<'a> {
    /// Split into the nullable (team_id, user_id) columns the row stores.
    pub fn into_ids(self) -> (Option<Uuid>, Option<&'a MacroUserIdStr<'a>>) {
        match self {
            PropertyDefinitionOwner::User(user_id) => (None, Some(user_id)),
            PropertyDefinitionOwner::Team(team_id) => (Some(team_id), None),
        }
    }
}

/// Which owner a tag set belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagScope {
    /// The caller's personal tag set.
    User,
    /// The caller's team tag set.
    Team,
}

/// A tag set the caller can use. `definition` is `None` until the set is
/// provisioned (on first label create), in which case `options` is empty.
#[derive(Debug, Clone)]
pub struct TagSet {
    /// The owner scope of the tag set.
    pub scope: TagScope,
    /// The tag property definition, if provisioned.
    pub definition: Option<PropertyDefinition>,
    /// The tag options (labels) in the set.
    pub options: Vec<PropertyOption>,
}

/// Outcome of an in-place property option update.
#[derive(Debug, Clone)]
pub enum UpdatePropertyOptionOutcome {
    /// The option was updated.
    Updated(PropertyOption),
    /// No option with the given id exists.
    NotFound,
    /// Another option on the same property already has the requested value.
    DuplicateValue,
}

/// A task-assignment notification expressed in domain terms.
///
/// Outbound adapters enrich this (task name, sender profile picture) and
/// translate it to the concrete notification infrastructure, fanning out one
/// notification per recipient.
#[derive(Debug, Clone)]
pub struct TaskAssignedNotification<'a> {
    /// The task the recipients were assigned to.
    pub task_id: Uuid,
    /// The user who assigned the task.
    pub assigned_by: MacroUserIdStr<'a>,
    /// The newly assigned users to notify.
    pub recipient_ids: Vec<MacroUserIdStr<'a>>,
}
