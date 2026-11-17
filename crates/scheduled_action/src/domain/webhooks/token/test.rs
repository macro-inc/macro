use super::*;

#[test]
fn a_token_is_its_prefix_then_its_secret() {
    let token = WebhookToken::generate();
    let parts: Vec<&str> = token.as_str().split('_').collect();

    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0], "mrw");
    assert_eq!(parts[1].len(), PREFIX_CHARS);
    assert_eq!(parts[2].len(), SECRET_BYTES * 2);
    assert!(parts[2].starts_with(parts[1]));
    assert_eq!(token.prefix(), format!("mrw_{}", parts[1]));
}

#[test]
fn a_generated_token_parses_and_hashes_the_same() {
    let token = WebhookToken::generate();
    let parsed = WebhookToken::parse(token.as_str()).unwrap();

    assert_eq!(parsed, token);
    assert_eq!(parsed.hash(), token.hash());
    assert_ne!(WebhookToken::generate().hash(), token.hash());
}

#[test]
fn only_the_generated_shape_parses() {
    let token = WebhookToken::generate();
    let secret = &token.as_str()[17..];
    for invalid in [
        String::new(),
        "mrw_".to_owned(),
        token.as_str().to_uppercase(),
        format!("{}0", token.as_str()),
        format!("mdbw_{}_{secret}", &secret[..12]),
        // The prefix must be the secret's start.
        format!("mrw_{}_{secret}", "0".repeat(12)),
    ] {
        assert_eq!(WebhookToken::parse(&invalid), None, "{invalid}");
    }
}

#[test]
fn debug_shows_only_the_prefix() {
    let token = WebhookToken::generate();

    let shown = format!("{token:?}");

    assert!(shown.contains(token.prefix()));
    assert!(!shown.contains(&token.as_str()[17..]));
}
