//! `uuid_id!`: a UUID-backed id newtype, so one kind of id never stands in
//! for another.
//!
//! Each id is a [`nutype`] over [`uuid::Uuid`] that serializes as the plain
//! UUID string. Schema derives are the caller's: pass them after the name, as
//! nutype arguments, so `utoipa`, `specta` and `schemars` stay dependencies of
//! the crate that needs them.
//!
//! ```ignore
//! id_newtype::uuid_id!(
//!     /// Identifier of one table within a database.
//!     #[schema(value_type = Uuid)]
//!     pub TableId;
//!     derive_unchecked(utoipa::ToSchema)
//! );
//! ```
//!
//! An id gets `generate()` (a fresh UUIDv7), `from_uuid`, `as_uuid`,
//! `into_uuid`, `Default` (a fresh id), `From<Uuid>` and back, `Display` and
//! `FromStr` (with `uuid::Error`). nutype also adds `new(Uuid)`, the same as
//! `from_uuid`.

#![deny(missing_docs)]

#[cfg(test)]
mod test;

#[doc(hidden)]
pub mod __private {
    pub use macro_uuid::generate_uuid_v7;
    pub use nutype::nutype;
    pub use uuid::{Error, Uuid};
}

/// Define a UUID-backed id newtype; see the [crate docs](crate).
#[macro_export]
macro_rules! uuid_id {
    ($(#[$attribute:meta])* $visibility:vis $name:ident $(; $($nutype_argument:tt)+)?) => {
        #[$crate::__private::nutype(
            const_fn,
            derive(
                Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, AsRef,
                Display, From, Into, Serialize, Deserialize,
            )
            $(, $($nutype_argument)+)?
        )]
        $(#[$attribute])*
        $visibility struct $name($crate::__private::Uuid);

        impl $name {
            /// A fresh, time-ordered (UUIDv7) id.
            pub fn generate() -> Self {
                Self::new($crate::__private::generate_uuid_v7())
            }

            /// The id a stored or received UUID names.
            pub const fn from_uuid(uuid: $crate::__private::Uuid) -> Self {
                Self::new(uuid)
            }

            /// The UUID, for storage and transport adapters.
            pub fn as_uuid(&self) -> &$crate::__private::Uuid {
                self.as_ref()
            }

            /// The UUID, consuming the id.
            pub fn into_uuid(self) -> $crate::__private::Uuid {
                self.into_inner()
            }
        }

        impl ::core::default::Default for $name {
            fn default() -> Self {
                Self::generate()
            }
        }

        impl ::core::str::FromStr for $name {
            type Err = $crate::__private::Error;

            fn from_str(text: &str) -> ::core::result::Result<Self, Self::Err> {
                $crate::__private::Uuid::parse_str(text).map(Self::new)
            }
        }
    };
}
