use async_graphql::Enum;
use model_entity::EntityType;

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

impl From<EntityType> for GraphqlSoupEntityType {
    fn from(entity_type: EntityType) -> Self {
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
}

impl From<GraphqlSoupEntityType> for EntityType {
    fn from(entity_type: GraphqlSoupEntityType) -> Self {
        match entity_type {
            GraphqlSoupEntityType::Document => Self::Document,
            GraphqlSoupEntityType::Chat => Self::Chat,
            GraphqlSoupEntityType::Project => Self::Project,
            GraphqlSoupEntityType::EmailThread => Self::EmailThread,
            GraphqlSoupEntityType::Channel => Self::Channel,
            GraphqlSoupEntityType::ChannelMessage => Self::ChannelMessage,
            GraphqlSoupEntityType::Call => Self::Call,
            GraphqlSoupEntityType::CrmCompany => Self::CrmCompany,
            GraphqlSoupEntityType::ForeignEntity => Self::ForeignEntity,
        }
    }
}

impl From<EntityType> for GraphqlEntityType {
    fn from(entity_type: EntityType) -> Self {
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
}

impl From<GraphqlEntityType> for EntityType {
    fn from(entity_type: GraphqlEntityType) -> Self {
        match entity_type {
            GraphqlEntityType::Document => Self::Document,
            GraphqlEntityType::Chat => Self::Chat,
            GraphqlEntityType::Project => Self::Project,
            GraphqlEntityType::EmailThread => Self::EmailThread,
            GraphqlEntityType::Channel => Self::Channel,
            GraphqlEntityType::ChannelMessage => Self::ChannelMessage,
            GraphqlEntityType::Call => Self::Call,
            GraphqlEntityType::CrmCompany => Self::CrmCompany,
            GraphqlEntityType::ForeignEntity => Self::ForeignEntity,
            GraphqlEntityType::User => Self::User,
            GraphqlEntityType::Team => Self::Team,
            GraphqlEntityType::StaticFile => Self::StaticFile,
            GraphqlEntityType::CrmContact => Self::CrmContact,
        }
    }
}

impl From<GraphqlSoupEntityType> for GraphqlEntityType {
    fn from(entity_type: GraphqlSoupEntityType) -> Self {
        EntityType::from(entity_type).into()
    }
}
