//! The id of a Macro project (a folder of documents and other entities).

#![deny(missing_docs)]

use nutype::nutype;

#[cfg(test)]
mod test;

/// The id of a Macro project (a folder of documents and other entities).
///
/// Stored as `TEXT`. Ids are usually UUID strings but need not be, so the
/// type does not parse them; it only keeps one kind of id from standing in
/// for another.
#[nutype(
    derive(
        Debug,
        Clone,
        PartialEq,
        Eq,
        Hash,
        PartialOrd,
        Ord,
        AsRef,
        Display,
        From,
        Into,
        Serialize,
        Deserialize,
    ),
    cfg_attr(feature = "sqlx", derive_unchecked(sqlx::Type)),
    cfg_attr(feature = "schema", derive_unchecked(utoipa::ToSchema))
)]
#[cfg_attr(feature = "sqlx", sqlx(transparent))]
#[cfg_attr(feature = "schema", schema(value_type = String))]
pub struct ProjectId(String);

impl ProjectId {
    /// The id as a string, for storage and transport adapters.
    pub fn as_str(&self) -> &str {
        self.as_ref()
    }
}
