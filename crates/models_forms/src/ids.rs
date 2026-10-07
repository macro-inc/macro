//! Identifiers of a form's parts.

#[cfg(test)]
mod test;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A UUID newtype per kind of part, so one kind of id never stands in for
/// another. On the wire and in every generated schema each is the plain
/// UUID string it wraps. Copied from `models_databases`, whose macro stays
/// private to it.
macro_rules! form_id {
    ($(#[$attribute:meta])* $name:ident) => {
        $(#[$attribute])*
        #[derive(
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            Hash,
            PartialOrd,
            Ord,
            Serialize,
            Deserialize,
            utoipa::ToSchema,
            specta::Type,
        )]
        #[serde(transparent)]
        #[specta(transparent)]
        #[schema(value_type = Uuid)]
        pub struct $name(Uuid);

        impl $name {
            /// A fresh, time-ordered (UUIDv7) id.
            pub fn new() -> Self {
                Self(macro_uuid::generate_uuid_v7())
            }

            /// The id a stored or received UUID names.
            pub const fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            /// The UUID, for storage and transport adapters.
            pub const fn as_uuid(&self) -> &Uuid {
                &self.0
            }

            /// The UUID, consuming the id.
            pub const fn into_uuid(self) -> Uuid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl From<Uuid> for $name {
            fn from(uuid: Uuid) -> Self {
                Self(uuid)
            }
        }

        impl From<$name> for Uuid {
            fn from(id: $name) -> Self {
                id.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;

            fn from_str(text: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(text).map(Self)
            }
        }
    };
}

form_id!(
    /// Identifier of a form (the shareable entity respondents open).
    FormId
);
form_id!(
    /// Identifier of one section of a form's layout, minted by the client.
    FormSectionId
);
form_id!(
    /// Identifier of one question of a form's layout, minted by the client.
    FormQuestionId
);
form_id!(
    /// Identifier of one entry of a form's submission ledger.
    FormResponseId
);
form_id!(
    /// Identifier of the native scheduling profile selected by a form.
    BookingProfileId
);
form_id!(
    /// Identifier of the native scheduling event type selected by a form.
    BookingEventTypeId
);
