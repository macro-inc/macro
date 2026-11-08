//! The id of a message in a channel, discussion or chat thread.

#![deny(missing_docs)]

#[cfg(test)]
mod test;

id_newtype::uuid_id!(
    /// The id of a message.
    #[cfg_attr(feature = "sqlx", sqlx(transparent))]
    #[cfg_attr(feature = "schema", schema(value_type = String, format = Uuid))]
    pub MessageId;
    cfg_attr(feature = "sqlx", derive_unchecked(sqlx::Type)),
    cfg_attr(feature = "schema", derive_unchecked(utoipa::ToSchema))
);
