use async_graphql::{Enum, ID, Object};
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
}

impl GraphqlSoupEntityType {
    /// Construct a GraphQL Soup entity type from the canonical model type.
    pub fn new(entity_type: EntityType) -> Self {
        match entity_type {
            EntityType::Document => Self::Document,
            EntityType::Chat => Self::Chat,
            EntityType::Project => Self::Project,
            EntityType::EmailThread => Self::EmailThread,
            EntityType::Channel => Self::Channel,
            EntityType::ChannelMessage => Self::ChannelMessage,
            EntityType::Call => Self::Call,
            EntityType::CrmCompany => Self::CrmCompany,
            EntityType::ForeignEntity => Self::ForeignEntity,
            unsupported => panic!("{unsupported} is not a Soup entity type"),
        }
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
            EntityType::CrmCompany => Self::CrmCompany,
            EntityType::ForeignEntity => Self::ForeignEntity,
            EntityType::User => Self::User,
            EntityType::Team => Self::Team,
            EntityType::StaticFile => Self::StaticFile,
            EntityType::CrmContact => Self::CrmContact,
        }
    }

    /// Construct a canonical GraphQL entity type from a Soup entity type.
    pub fn new_from_soup_entity_type(entity_type: GraphqlSoupEntityType) -> Self {
        Self::new(entity_type.into_model())
    }

    /// Convert this GraphQL entity type into the canonical model type.
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
            Self::User => EntityType::User,
            Self::Team => EntityType::Team,
            Self::StaticFile => EntityType::StaticFile,
            Self::CrmContact => EntityType::CrmContact,
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
