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
fn named_instance_fusionauth_urls_are_local() {
    assert!(is_local_fusionauth("http://localhost:28005"));
    assert!(is_local_fusionauth("http://127.0.0.1:28005"));
    assert!(is_local_fusionauth("http://[::1]:28005"));
    assert!(!is_local_fusionauth("https://fusionauth-dev.macro.com"));
}
