use super::AccessToken;

#[test]
fn access_token_debug_output_is_redacted() {
    let output = format!("{:?}", AccessToken::new("secret-token-value"));

    assert_eq!(output, "AccessToken([REDACTED])");
    assert!(!output.contains("secret-token-value"));
}
