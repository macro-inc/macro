use super::token_is_valid;

#[test]
fn only_a_plain_long_token_is_accepted() {
    assert!(token_is_valid("abcdefghijklmnopqrstuvwxyz0123456789"));
    assert!(!token_is_valid("short"));
    assert!(!token_is_valid("abcdefghijklmnopqrstuvwxyz 0123456789"));
    assert!(!token_is_valid("abcdefghijklmnopqrstuvwxyz\"0123456789"));
    assert!(!token_is_valid(
        "Error: you do not have access to this config"
    ));
}
