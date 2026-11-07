use async_graphql::Enum;
use model_owner::OwnerType;

/// GraphQL representation of [`OwnerType`]: the kind of principal that owns an
/// entity. Paired with an `ownerId` principal string, which is a user id, a
/// bot id, or a team id depending on this discriminator.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Hash)]
pub enum GraphqlOwnerType {
    /// A Macro user.
    User,
    /// A bot.
    Bot,
    /// A team.
    Team,
}

impl From<OwnerType> for GraphqlOwnerType {
    fn from(value: OwnerType) -> Self {
        match value {
            OwnerType::User => Self::User,
            OwnerType::Bot => Self::Bot,
            OwnerType::Team => Self::Team,
        }
    }
}
