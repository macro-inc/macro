#[cfg(test)]
mod test;

use async_graphql::{Enum, ID, Object, SimpleObject};
use model_entity::{Entity, EntityType};

/// GraphQL representation of Soup entity types.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Hash)]
pub enum GraphqlSoupEntityType {
    /// Initiative entity, presented as a project in the frontend.
    Initiative,
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
    /// CRM contact entity.
    CrmContact,
    /// Foreign entity.
    ForeignEntity,
    /// Calendar event entity.
    CalendarEvent,
    /// AI coding agent session entity.
    AgentSession,
    /// Row of a Macro database table.
    DatabaseRow,
    /// A paired runtime, listed only by attention feeds.
    Harness,
    /// An entity outside Soup, such as a routine. Only the deprecated
    /// notification `entityType` returns it; read `targetEntityType` instead.
    /// Rejected as input.
    #[graphql(
        deprecation = "Only returned by the deprecated notification entityType. Remove after 2026-12-15."
    )]
    OutsideSoup,
}

/// Canonical entity types accepted by cross-entity APIs.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Hash)]
pub enum GraphqlEntityType {
    /// CRM pipeline entity.
    CrmPipeline,
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
    /// AI coding agent session entity.
    AgentSession,
    /// Scheduled action entity.
    ScheduledAction,
    /// Initiative entity.
    Initiative,
    /// Macro Database entity (a collection of user-defined tables).
    Database,
    /// Row of a Macro Database table.
    DatabaseRow,
    /// Macro Form entity (a questionnaire answered into a database table).
    Form,
    /// Independently shared external chat.
    #[graphql(name = "EXTERNAL_CHAT")]
    ExternalChat,
    /// Schema-only stub for clients released with this value before external
    /// chats replaced WhatsApp groups. Never returned; rejected as input.
    #[graphql(
        deprecation = "Use EXTERNAL_CHAT. Never returned; rejected as input. Remove after 2026-11-30."
    )]
    WhatsappGroup,
    /// A registered runtime.
    Harness,
}

impl GraphqlSoupEntityType {
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
            EntityType::CrmContact => Self::CrmContact,
            EntityType::ForeignEntity => Self::ForeignEntity,
            EntityType::CalendarEvent => Self::CalendarEvent,
            EntityType::AgentSession => Self::AgentSession,
            EntityType::Initiative => Self::Initiative,
            EntityType::DatabaseRow => Self::DatabaseRow,
            EntityType::Harness => Self::Harness,
            EntityType::User
            | EntityType::Reminder
            | EntityType::Team
            | EntityType::StaticFile
            | EntityType::Skill
            | EntityType::ScheduledAction
            | EntityType::CrmPipeline
            | EntityType::Database
            | EntityType::ExternalChat
            | EntityType::Form => return None,
        })
    }

    /// Convert this GraphQL Soup entity type into the canonical model type.
    /// Errors for `OUTSIDE_SOUP`, which names no entity type.
    pub fn into_model(self) -> async_graphql::Result<EntityType> {
        Ok(match self {
            Self::Document => EntityType::Document,
            Self::Chat => EntityType::Chat,
            Self::Project => EntityType::Project,
            Self::EmailThread => EntityType::EmailThread,
            Self::Channel => EntityType::Channel,
            Self::ChannelMessage => EntityType::ChannelMessage,
            Self::Call => EntityType::Call,
            Self::CrmCompany => EntityType::CrmCompany,
            Self::CrmContact => EntityType::CrmContact,
            Self::ForeignEntity => EntityType::ForeignEntity,
            Self::CalendarEvent => EntityType::CalendarEvent,
            Self::AgentSession => EntityType::AgentSession,
            Self::Initiative => EntityType::Initiative,
            Self::DatabaseRow => EntityType::DatabaseRow,
            Self::Harness => EntityType::Harness,
            Self::OutsideSoup => {
                return Err(async_graphql::Error::new(
                    "OUTSIDE_SOUP is not a Soup entity type",
                ));
            }
        })
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
            EntityType::AgentSession => Self::AgentSession,
            EntityType::ScheduledAction => Self::ScheduledAction,
            EntityType::Initiative => Self::Initiative,
            EntityType::CrmPipeline => Self::CrmPipeline,
            EntityType::Database => Self::Database,
            EntityType::DatabaseRow => Self::DatabaseRow,
            EntityType::Form => Self::Form,
            EntityType::ExternalChat => Self::ExternalChat,
            EntityType::Harness => Self::Harness,
        }
    }

    /// Convert this GraphQL entity type into the canonical model type.
    /// Errors for the schema-only `WHATSAPP_GROUP` stub.
    pub fn into_model(self) -> async_graphql::Result<EntityType> {
        Ok(match self {
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
            Self::AgentSession => EntityType::AgentSession,
            Self::ScheduledAction => EntityType::ScheduledAction,
            Self::Initiative => EntityType::Initiative,
            Self::CrmPipeline => EntityType::CrmPipeline,
            Self::Database => EntityType::Database,
            Self::DatabaseRow => EntityType::DatabaseRow,
            Self::Form => EntityType::Form,
            Self::ExternalChat => EntityType::ExternalChat,
            Self::Harness => EntityType::Harness,
            Self::WhatsappGroup => {
                return Err(async_graphql::Error::new(
                    "WHATSAPP_GROUP is no longer an entity type; use EXTERNAL_CHAT",
                ));
            }
        })
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
