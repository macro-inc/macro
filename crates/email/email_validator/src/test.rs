use super::EmailAddress;

#[test]
fn decodes_only_valid_addresses() {
    let address: EmailAddress = serde_json::from_str(r#""ada@example.com""#).unwrap();
    assert_eq!(address.as_ref(), "ada@example.com");

    assert!(serde_json::from_str::<EmailAddress>(r#""Ada <ada@example.com>""#).is_err());
    assert!(serde_json::from_str::<EmailAddress>(r#""ada@""#).is_err());
}
