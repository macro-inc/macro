//! Identifiers of a Macro form's parts: the form, its layout's sections and
//! questions, its submissions, and the scheduling profile and event type it
//! books.
//!
//! `models_forms` re-exports them; they live here so a crate that only names
//! a form does not depend on the forms wire vocabulary.

#![deny(missing_docs)]

#[cfg(test)]
mod test;

// A UUID newtype per kind of part, so one kind of id never stands in for
// another. On the wire and in every generated schema each is the plain UUID
// string it wraps.
macro_rules! form_id {
    ($(#[$attribute:meta])* $name:ident) => {
        id_newtype::uuid_id!(
            $(#[$attribute])*
            #[specta(transparent)]
            #[schema(value_type = Uuid)]
            pub $name;
            derive_unchecked(utoipa::ToSchema, specta::Type),
            cfg_attr(feature = "schema", derive_unchecked(schemars::JsonSchema))
        );
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
