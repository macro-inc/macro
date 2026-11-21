//! The deployed worker still owns a separate generated schema crate.

const CLIENT_SCHEMA: &[u8] = include_bytes!("../bebop/schema.bop");
const SERVICE_SCHEMA: &[u8] = include_bytes!("../../../services/sync-service/bebop/schema.bop");
const CLIENT_RUST: &str = include_str!("generated.rs");
const SERVICE_RUST: &str =
    include_str!("../../../services/sync-service/bebop-schema/src/generated.rs");
const SERVICE_OWNED: &str = "#[cfg(feature = \"bebop-owned-all\")]";
const CLIENT_OWNED: &str = "#[cfg(feature = \"owned\")]";

#[test]
fn deployed_service_schema_is_byte_identical() {
    assert_eq!(CLIENT_SCHEMA, SERVICE_SCHEMA);
}

#[test]
fn deployed_service_generated_rust_differs_only_in_owned_feature_name() {
    assert_eq!(SERVICE_RUST.matches(SERVICE_OWNED).count(), 1);
    assert_eq!(SERVICE_RUST.matches(CLIENT_OWNED).count(), 0);
    assert_eq!(CLIENT_RUST.matches(CLIENT_OWNED).count(), 1);
    assert_eq!(CLIENT_RUST.matches(SERVICE_OWNED).count(), 0);
    assert_eq!(
        CLIENT_RUST,
        SERVICE_RUST.replace(SERVICE_OWNED, CLIENT_OWNED)
    );
}
