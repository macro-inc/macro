//! Source-of-truth schemas for browser/native person-policy transport.
use super::*;

/// Generate the bounded person transport models without duplicating DTOs.
pub fn schemas() -> serde_json::Value {
    serde_json::json!({
        "policyVersion": PEOPLE_POLICY_VERSION,
        "maxBatch": MAX_PEOPLE_BATCH,
        "maxReferenceWitnesses": MAX_REFERENCE_WITNESSES,
        "maxQueryBytes": subsequence_match::MAX_QUERY_BYTES,
        "schemas": {
            "PeopleScope": schemars::schema_for!(HydrationScope),
            "PeopleSearch": schemars::schema_for!(PeopleSearch),
            "PeopleContextUpdate": schemars::schema_for!(ContextUpdate),
            "PeopleContextState": schemars::schema_for!(ContextState),
            "PeopleSearchResult": schemars::schema_for!(PeopleSearchResult),
            "PeopleReferenceRequest": schemars::schema_for!(PeopleReferenceRequest),
            "PeopleReferenceResult": schemars::schema_for!(PeopleReferenceResult),
        }
    })
}
