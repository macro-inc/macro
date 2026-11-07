use super::*;

#[test]
fn key_ids_and_aliases_become_transit_names() {
    assert_eq!(transit_key("alias/cursor-api-key"), "alias-cursor-api-key");
    assert_eq!(transit_key("arn:aws:kms:x"), "arn-aws-kms-x");
    assert_eq!(transit_key("plain"), "plain");
}

#[test]
fn a_blob_round_trips_its_key_and_ciphertext() {
    let blob = encode_blob("alias-a", "vault:v1:abc");
    assert_eq!(
        decode_blob(&blob),
        Some(("alias-a".to_owned(), "vault:v1:abc".to_owned()))
    );
}

#[test]
fn a_blob_from_elsewhere_is_rejected() {
    assert_eq!(decode_blob("not base64!"), None);
    assert_eq!(decode_blob(&STANDARD.encode("no separator")), None);
}

#[test]
fn context_order_does_not_change_the_associated_data() {
    let first = json!({ "EncryptionContext": { "a": "1", "b": "2" } });
    let second = json!({ "EncryptionContext": { "b": "2", "a": "1" } });
    assert_eq!(associated_data(&first), associated_data(&second));
}

#[test]
fn a_different_context_changes_the_associated_data() {
    let first = json!({ "EncryptionContext": { "a": "1" } });
    let second = json!({ "EncryptionContext": { "a": "2" } });
    assert_ne!(associated_data(&first), associated_data(&second));
    assert_ne!(associated_data(&first), associated_data(&json!({})));
}

#[test]
fn a_key_id_is_required() {
    assert!(key_of(&json!({})).is_err());
    assert!(key_of(&json!({ "KeyId": "" })).is_err());
    assert!(matches!(key_of(&json!({ "KeyId": "alias/a" })), Ok(key) if key == "alias-a"));
}

#[test]
fn a_created_key_reports_an_id_and_arn() {
    let created = create_key();
    let id = created["KeyMetadata"]["KeyId"].as_str().unwrap();
    assert!(
        created["KeyMetadata"]["Arn"]
            .as_str()
            .unwrap()
            .ends_with(id)
    );
}
