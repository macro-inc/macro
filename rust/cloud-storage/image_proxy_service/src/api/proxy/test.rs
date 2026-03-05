use super::*;

#[test]
fn test_proxy_params_deserialization() {
    let params: ProxyParams =
        serde_json::from_str(r#"{"url":"https://example.com/image.png"}"#).unwrap();
    assert_eq!(params.url, "https://example.com/image.png");
}
