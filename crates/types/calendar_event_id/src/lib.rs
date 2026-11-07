//! The id of a calendar event Macro stores.

#![deny(missing_docs)]

#[cfg(test)]
mod test;

id_newtype::uuid_id!(
    /// The id of a calendar event row in Macro (`calendar_events.id`).
    ///
    /// Not the provider's event id (Google or Outlook), which is a string.
    #[cfg_attr(feature = "sqlx", sqlx(transparent))]
    #[cfg_attr(feature = "schema", schema(value_type = String, format = Uuid))]
    pub CalendarEventId;
    cfg_attr(feature = "sqlx", derive_unchecked(sqlx::Type)),
    cfg_attr(feature = "schema", derive_unchecked(utoipa::ToSchema))
);
