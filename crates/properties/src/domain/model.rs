//! Domain models for properties.

#[cfg(test)]
mod test;

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityType as AccessEntityType,
    RequiredPermission, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::entity_property::EntityProperty;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityReference, EntityType, PropertyOwner};
use uuid::Uuid;

/// Map an internal properties storage type to its canonical entity type.
pub fn canonical_entity_type(entity_type: EntityType) -> AccessEntityType {
    match entity_type {
        EntityType::CalendarEvent => AccessEntityType::CalendarEvent,
        EntityType::Document | EntityType::Task => AccessEntityType::Document,
        EntityType::CallRecord => AccessEntityType::Call,
        EntityType::Chat => AccessEntityType::Chat,
        EntityType::Project => AccessEntityType::Project,
        EntityType::Thread => AccessEntityType::EmailThread,
        EntityType::Channel => AccessEntityType::Channel,
        EntityType::Company => AccessEntityType::CrmCompany,
        EntityType::User => AccessEntityType::User,
    }
}

/// Map a canonical entity type to its properties storage type.
///
/// Inverse of [`canonical_entity_type`]. `Document` covers task documents
/// too; callers that need the task refinement resolve the document subtype
/// themselves. `None` means the canonical type has no properties storage.
pub fn storage_entity_type(entity_type: AccessEntityType) -> Option<EntityType> {
    match entity_type {
        AccessEntityType::CalendarEvent => Some(EntityType::CalendarEvent),
        AccessEntityType::Document => Some(EntityType::Document),
        AccessEntityType::Call => Some(EntityType::CallRecord),
        AccessEntityType::Chat => Some(EntityType::Chat),
        AccessEntityType::Project => Some(EntityType::Project),
        AccessEntityType::EmailThread => Some(EntityType::Thread),
        AccessEntityType::Channel => Some(EntityType::Channel),
        AccessEntityType::CrmCompany => Some(EntityType::Company),
        AccessEntityType::User => Some(EntityType::User),
        AccessEntityType::ChannelMessage
        | AccessEntityType::Team
        | AccessEntityType::ForeignEntity
        | AccessEntityType::StaticFile
        | AccessEntityType::CrmContact
        | AccessEntityType::Reminder
        | AccessEntityType::Skill
        | AccessEntityType::AgentSession => None,
    }
}

/// Proof of view (or better) access to one canonical entity.
pub type ViewReceipt = EntityAccessReceipt<ViewAccessLevel>;
/// Proof of edit (or better) access to one canonical entity.
pub type EditReceipt = EntityAccessReceipt<EditAccessLevel>;

/// Convenience accessors for canonical property access receipts.
pub trait PropertyAccessReceiptExt {
    /// Canonical entity identifier.
    fn entity_id(&self) -> &str;
    /// Canonical entity type.
    fn entity_type(&self) -> AccessEntityType;
    /// Authenticated user, if the receipt represents one.
    fn authenticated_user(&self) -> Option<&MacroUserIdStr<'static>>;
}

impl<T: RequiredPermission> PropertyAccessReceiptExt for EntityAccessReceipt<T> {
    fn entity_id(&self) -> &str {
        &self.entity().entity_id
    }

    fn entity_type(&self) -> AccessEntityType {
        self.entity().entity_type
    }

    fn authenticated_user(&self) -> Option<&MacroUserIdStr<'static>> {
        match self.auth() {
            EntityAccessAuth::Authenticated(user) => Some(user),
            EntityAccessAuth::Bot(_)
            | EntityAccessAuth::Unauthenticated
            | EntityAccessAuth::Internal => None,
        }
    }
}

/// Canonical key identifying an entity receiving properties.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PropertyTargetKey {
    /// Canonical entity identifier.
    pub entity_id: String,
    /// Canonical entity type. Tasks use `Document`.
    pub entity_type: AccessEntityType,
}

/// A canonical property target resolved to its internal storage namespace.
#[derive(Debug, Clone)]
pub(crate) struct ResolvedPropertySubject {
    pub(crate) canonical_key: PropertyTargetKey,
    pub(crate) storage_entity_type: EntityType,
}

impl ResolvedPropertySubject {
    /// Return the repository key for this subject.
    pub(crate) fn storage_key(&self) -> EntityPropertiesKey {
        EntityPropertiesKey {
            entity_id: self.canonical_key.entity_id.clone(),
            entity_type: self.storage_entity_type,
        }
    }
}

/// Internal repository key identifying properties attached to one entity.
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

/// Result of getting or creating an owner's tag definition.
#[derive(Debug, Clone)]
pub struct GetOrCreateTagDefinitionResult {
    /// The owner's tag property definition.
    pub definition: PropertyDefinition,
    /// Whether this operation created the definition.
    pub created: bool,
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

/// The persisted result of moving a personal label into a team tag set.
#[derive(Debug, Clone)]
pub struct TagRemapOutcome {
    /// The team-owned option the label resolves to after the remap.
    pub option: PropertyOption,
    /// One post-commit snapshot per entity whose team tag value was rewritten,
    /// used to publish the entity-property events that drive search and Soup.
    pub mutations: Vec<EntityPropertyMutationSnapshot>,
}

/// Result of promoting a personal label into the caller's team tag set.
#[derive(Debug, Clone)]
pub enum TagPromotionOutcome {
    /// The label moved to the team tag set, keeping its option id so every
    /// entity already carrying it keeps resolving to the same label.
    Promoted(TagRemapOutcome),
    /// The team already has a label with that name (compared case-insensitively
    /// on the trimmed value). Carries that team label so the caller can offer to
    /// merge into it instead.
    Conflict(PropertyOption),
}

/// One property's requested option changes in a bulk selection update.
///
/// The change is expressed as a delta (options to add, options to remove) rather
/// than a target set so it composes with concurrent edits under the row lock: a
/// bulk update only touches the options it names, leaving any options a
/// concurrent writer added or removed intact.
#[derive(Debug, Clone)]
pub struct EntityPropertyOptionUpdate {
    /// The multi-select property definition being changed.
    pub property_definition_id: Uuid,
    /// Options to add to the current stored value (deduped, order-preserving).
    pub add_option_ids: Vec<Uuid>,
    /// Options to strip from the current stored value (a no-op if absent).
    pub remove_option_ids: Vec<Uuid>,
}

/// The full persisted state of an entity property after a mutation.
///
/// This is an internal persistence receipt used for post-commit side effects;
/// it is not part of the service or HTTP response contract.
#[doc(hidden)]
#[derive(Debug, Clone)]
pub struct EntityPropertyMutationSnapshot {
    /// The canonical persisted entity-property assignment.
    pub property: EntityProperty,
    /// The complete value after the mutation.
    pub value: Option<PropertyValue>,
    /// The complete value before the mutation: `None` when the property was
    /// not previously attached (or the stored value didn't decode). Captured
    /// in the same statement/transaction as the write, so it feeds the
    /// "changed X from A to B" activity transition.
    pub previous_value: Option<PropertyValue>,
}

/// The reconciled final option ids for one property after a bulk update. The
/// caller uses these to reconcile its cache with the value the server actually
/// persisted (which may differ from the requested delta if a concurrent edit
/// merged in).
#[derive(Debug, Clone)]
pub struct EntityPropertyOptionSelection {
    /// The property definition the options belong to.
    pub property_definition_id: Uuid,
    /// The final option ids stored for the entity's property, in stored order.
    pub option_ids: Vec<Uuid>,
    /// The post-mutation persistence receipt, or `None` when no row was changed.
    #[allow(
        dead_code,
        reason = "internal persistence receipt is intentionally omitted from public responses"
    )]
    pub(crate) mutation: Option<EntityPropertyMutationSnapshot>,
}

/// The outcome of applying one shared option delta to a single entity in a
/// cross-entity bulk update.
///
/// The batch is best-effort per entity: each entity gets its own transaction,
/// so one entity failing does not roll back the others. An entity the caller
/// could not edit never reaches the domain (its receipt was never minted), so
/// the "skipped, no permission" case lives only at the transport/tool boundary
/// and is not represented here.
#[derive(Debug, Clone)]
pub enum EntityOptionUpdateOutcome {
    /// The delta was applied; carries the entity's reconciled final option ids.
    Applied {
        /// The final option ids stored for the entity's property, in stored order.
        option_ids: Vec<Uuid>,
    },
    /// The delta was not applied to this entity (the property does not apply to
    /// its type, or the write failed). Carries a human-readable reason.
    Failed {
        /// Why the delta was not applied.
        message: String,
    },
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
