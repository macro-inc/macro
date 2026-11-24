//! The stored fields Soup's index projections read, so a GraphQL schema
//! change that removes a field drops only the records whose documents read it
//! (`cache_core::schema_change`).
//!
//! Each projection keeps its list beside the code that reads the fields; this
//! gathers them. A field left off keeps a document complete after a schema
//! change removes the value its facts came from, so a projection that starts
//! reading a field adds it to its list. What storage's own derived rows read (Quick
//! Access, calendar ranges, people rows) comes with every `ProjectionInputs`.

use cache_core::schema_change::ProjectionInputs;

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

/// The fields each Soup and Mail index projection reads: those of the record
/// a document is keyed by, and those of the notification and property
/// records any document may hold facts from.
#[must_use]
pub fn projection_inputs() -> ProjectionInputs {
    let mut inputs = ProjectionInputs::none()
        .own("GraphqlSoupChannel", crate::channels::INPUTS)
        .own("GraphqlSoupDatabaseRow", crate::database_rows::INPUTS)
        .own(crate::mail::TYPE, crate::mail::FIELDS)
        .nested(
            "GraphqlNotification",
            crate::notifications::NOTIFICATION_INPUTS,
        )
        .nested("GraphqlProperty", crate::properties::PROPERTY_INPUTS);
    for (typename, fields) in crate::DIRECT_INPUTS {
        inputs = inputs.own(typename, fields);
    }
    for typename in crate::notifications::PARENTS {
        inputs = inputs.own(typename, crate::notifications::PARENT_INPUTS);
    }
    for typename in crate::properties::PARENTS {
        inputs = inputs.own(typename, crate::properties::PARENT_INPUTS);
    }
    inputs
}
