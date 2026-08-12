use async_graphql::{Enum, ID, Object, SimpleObject};
use model_entity::{Entity, EntityType};

/// GraphQL representation of Soup entity types.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Hash)]
pub enum GraphqlSoupEntityType {
    /// Document entity.
    Document,
    /// Chat entity.
    Chat,
    /// Project entity.
    Project,
    /// Email thread entity.
    EmailThread,
    /// Channel entity.
    Channel,
    /// Channel message entity.
    ChannelMessage,
    /// Call entity.
    Call,
    /// CRM company entity.
    CrmCompany,
    /// Foreign entity.
    ForeignEntity,
    /// Calendar event entity.
    CalendarEvent,
    /// Reminder entity.
    Reminder,
}

/// Canonical entity types accepted by cross-entity APIs.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Hash)]
pub enum GraphqlEntityType {
    /// Document entity.
    Document,
    /// Chat entity.
    Chat,
    /// Project entity.
    Project,
    /// Email thread entity.
    EmailThread,
    /// Channel entity.
    Channel,
    /// Channel message entity.
    ChannelMessage,
    /// Call entity.
    Call,
    /// Calendar event entity.
    CalendarEvent,
    /// CRM company entity.
    CrmCompany,
    /// Foreign entity.
    ForeignEntity,
    /// User entity.
    User,
    /// Team entity.
    Team,
    /// Static file entity.
    StaticFile,
    /// CRM contact entity.
    CrmContact,
    /// Reminder entity.
    Reminder,
    /// AI skill entity (skill document or built-in system skill).
    Skill,
}

impl GraphqlSoupEntityType {
    /// Construct a GraphQL Soup entity type from the canonical model type.
    pub fn new(entity_type: EntityType) -> Self {
        Self::try_new(entity_type).unwrap_or_else(|| {
            tracing::error!("{entity_type:?}");
            Self::Document
        })
    }

    /// Try to construct a GraphQL Soup entity type from the canonical model type.
    pub fn try_new(entity_type: EntityType) -> Option<Self> {
        Some(match entity_type {
            EntityType::Document => Self::Document,
            EntityType::Chat => Self::Chat,
            EntityType::Project => Self::Project,
            EntityType::EmailThread => Self::EmailThread,
            EntityType::Channel => Self::Channel,
            EntityType::ChannelMessage => Self::ChannelMessage,
            EntityType::Call => Self::Call,
            EntityType::CrmCompany => Self::CrmCompany,
            EntityType::ForeignEntity => Self::ForeignEntity,
            EntityType::CalendarEvent => Self::CalendarEvent,
            EntityType::Reminder => Self::Reminder,
            _ => return None,
        })
    }

    /// Convert this GraphQL Soup entity type into the canonical model type.
    pub fn into_model(self) -> EntityType {
        match self {
            Self::Document => EntityType::Document,
            Self::Chat => EntityType::Chat,
            Self::Project => EntityType::Project,
            Self::EmailThread => EntityType::EmailThread,
            Self::Channel => EntityType::Channel,
            Self::ChannelMessage => EntityType::ChannelMessage,
            Self::Call => EntityType::Call,
            Self::CrmCompany => EntityType::CrmCompany,
            Self::ForeignEntity => EntityType::ForeignEntity,
            Self::CalendarEvent => EntityType::CalendarEvent,
            Self::Reminder => EntityType::Reminder,
        }
    }
}

impl GraphqlEntityType {
    /// Construct a GraphQL entity type from the canonical model type.
    pub fn new(entity_type: EntityType) -> Self {
        match entity_type {
            EntityType::Document => Self::Document,
            EntityType::Chat => Self::Chat,
            EntityType::Project => Self::Project,
            EntityType::EmailThread => Self::EmailThread,
            EntityType::Channel => Self::Channel,
            EntityType::ChannelMessage => Self::ChannelMessage,
            EntityType::Call => Self::Call,
            EntityType::CalendarEvent => Self::CalendarEvent,
            EntityType::CrmCompany => Self::CrmCompany,
            EntityType::ForeignEntity => Self::ForeignEntity,
            EntityType::User => Self::User,
            EntityType::Team => Self::Team,
            EntityType::StaticFile => Self::StaticFile,
            EntityType::CrmContact => Self::CrmContact,
            EntityType::Reminder => Self::Reminder,
            EntityType::Skill => Self::Skill,
        }
    }

    /// Construct a canonical GraphQL entity type from a Soup entity type.
    pub fn new_from_soup_entity_type(entity_type: GraphqlSoupEntityType) -> Self {
        Self::new(entity_type.into_model())
    }

    /// Convert this GraphQL entity type into the canonical model type.
    pub fn into_model(self) -> EntityType {
        match self {
            Self::CalendarEvent => EntityType::CalendarEvent,
            Self::Document => EntityType::Document,
            Self::Chat => EntityType::Chat,
            Self::Project => EntityType::Project,
            Self::EmailThread => EntityType::EmailThread,
            Self::Channel => EntityType::Channel,
            Self::ChannelMessage => EntityType::ChannelMessage,
            Self::Call => EntityType::Call,
            Self::CrmCompany => EntityType::CrmCompany,
            Self::ForeignEntity => EntityType::ForeignEntity,
            Self::User => EntityType::User,
            Self::Team => EntityType::Team,
            Self::StaticFile => EntityType::StaticFile,
            Self::CrmContact => EntityType::CrmContact,
            Self::Reminder => EntityType::Reminder,
            Self::Skill => EntityType::Skill,
        }
    }
}

/// GraphQL wrapper over a canonical [`model_entity::Entity`].
pub struct GraphqlEntity<'a>(pub Entity<'a>);

/// Canonical reference to an entity.
#[Object]
impl<'a> GraphqlEntity<'a> {
    /// The entity's canonical identifier.
    async fn id(&self) -> ID {
        ID(self.0.entity_id.to_string())
    }

    /// The entity's canonical type.
    async fn entity_type(&self) -> GraphqlEntityType {
        GraphqlEntityType::new(self.0.entity_type)
    }
}

/// Marker instructing a normalized GraphQL cache to delete one entity record.
#[derive(SimpleObject)]
pub struct GraphqlCacheDeletion {
    /// Concrete GraphQL object type used in the normalized cache key.
    pub graphql_type_name: String,
    /// Identifier used in the normalized cache key.
    pub entity_id: ID,
}

impl GraphqlCacheDeletion {
    /// Constructs a cache deletion marker from its concrete GraphQL type and identifier.
    pub fn new(graphql_type_name: impl Into<String>, entity_id: impl Into<ID>) -> Self {
        Self {
            graphql_type_name: graphql_type_name.into(),
            entity_id: entity_id.into(),
        }
    }
}
