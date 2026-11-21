use super::*;

#[test]
fn production_refuses_an_allowlist_and_dev_reads_it() {
    let raw = Some("macro|tester@example.com");
    assert_eq!(
        configured(raw, Environment::Production),
        Err(RolloutAllowlistError::Production)
    );
    assert!(configured(raw, Environment::Develop).is_ok());
    assert_eq!(
        configured(None, Environment::Production),
        Ok(RolloutAllowlist::default())
    );
}
