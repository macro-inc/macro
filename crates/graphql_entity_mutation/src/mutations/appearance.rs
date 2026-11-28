use async_graphql::{Enum, InputObject, OneofObject};
use model_entity::{AppearanceIcon, Entity, EntityAppearance};

use super::EntityRefInput;

/// Color override from the shared tag palette.
#[derive(Clone, Copy, Eq, PartialEq, Enum)]
#[graphql(remote = "model_entity::AppearanceColor")]
enum GraphqlAppearanceColor {
    /// Neutral.
    Gray,
    /// Red.
    Red,
    /// Tomato.
    Tomato,
    /// Orange.
    Orange,
    /// Amber.
    Amber,
    /// Yellow.
    Yellow,
    /// Green.
    Green,
    /// Teal.
    Teal,
    /// Blue.
    Blue,
    /// Indigo.
    Indigo,
    /// Purple.
    Purple,
    /// Pink.
    Pink,
}

/// The glyph to display for the entity.
#[derive(OneofObject)]
enum AppearanceIconInput {
    /// Icon name from the Macro catalog.
    Macro(String),
    /// A single native emoji.
    Emoji(String),
}

impl From<AppearanceIconInput> for AppearanceIcon {
    fn from(input: AppearanceIconInput) -> Self {
        match input {
            AppearanceIconInput::Macro(name) => Self::Macro { name },
            AppearanceIconInput::Emoji(value) => Self::Emoji { value },
        }
    }
}

/// Replacement appearance for a document or initiative.
#[derive(InputObject)]
pub struct SetEntityAppearanceInput {
    /// Document or initiative to update.
    entity: EntityRefInput,
    /// Glyph override, omitted or null to use the entity's default icon.
    icon: Option<AppearanceIconInput>,
    /// Tint override, omitted or null to use the entity's default color.
    color: Option<GraphqlAppearanceColor>,
}

impl SetEntityAppearanceInput {
    /// Convert the GraphQL input into the entity reference and domain value.
    pub(super) fn into_model(self) -> async_graphql::Result<(Entity<'static>, EntityAppearance)> {
        Ok((
            self.entity.into_model()?,
            EntityAppearance {
                icon: self.icon.map(Into::into),
                color: self.color.map(Into::into),
            },
        ))
    }
}
