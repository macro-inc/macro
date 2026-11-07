use macro_auth::InternalApiKey;

#[test]
fn internal_api_key_supports_comptime_clone_and_as_ref() {
    let internal_api_key = InternalApiKey::Comptime("testing");
    let cloned_internal_api_key = internal_api_key.clone();

    assert_eq!(internal_api_key.as_ref(), "testing");
    assert_eq!(cloned_internal_api_key.as_ref(), "testing");
}
