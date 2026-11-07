//! The id of an email thread Macro stores (`email_threads.id`).

#![deny(missing_docs)]

#[cfg(test)]
mod test;

id_newtype::uuid_id!(
    /// The id of an email thread Macro stores (`email_threads.id`).
    ///
    /// Not the provider's thread id (Gmail or Outlook), which is a string.
    #[cfg_attr(feature = "sqlx", sqlx(transparent))]
    #[cfg_attr(feature = "schema", schema(value_type = String, format = Uuid))]
    pub EmailThreadId;
    cfg_attr(feature = "sqlx", derive_unchecked(sqlx::Type)),
    cfg_attr(feature = "schema", derive_unchecked(utoipa::ToSchema))
);
