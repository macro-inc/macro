use super::*;

#[test]
fn test_transform_local_fusionauth_url() {
    let urls = vec![
        (
            "http://fusionauth:9011/a/b/c/d",
            "http://localhost:9011/a/b/c/d",
        ),
        (
            "https://fusionauth-dev.macro.com",
            "https://fusionauth-dev.macro.com",
        ),
    ];

    for (value, expected) in urls.iter() {
        assert_eq!(&transform_local_fusionauth_url(value), expected);
    }
}

#[test]
fn named_instance_ports_are_not_inferred_as_fusionauth() {
    assert!(is_default_local_fusionauth("http://fusionauth:9011"));
    assert!(is_default_local_fusionauth("http://localhost:9011"));

    assert!(!is_default_local_fusionauth("http://localhost:28005"));
    assert!(!is_default_local_fusionauth("http://localhost:28006"));
    assert!(!is_default_local_fusionauth("http://localhost:28008"));
    assert!(!is_default_local_fusionauth("http://localhost:28009"));
    assert!(!is_default_local_fusionauth("http://localhost:28010"));
}

#[test]
fn tenant_header_is_explicitly_configurable() {
    let without_tenant = auth_headers("api-key".into(), "tenant-id".into(), false);
    assert!(!without_tenant.contains_key(FUSIONAUTH_TENANT_ID_HEADER));

    let with_tenant = auth_headers("api-key".into(), "tenant-id".into(), true);
    assert_eq!(with_tenant[FUSIONAUTH_TENANT_ID_HEADER], "tenant-id");
}
