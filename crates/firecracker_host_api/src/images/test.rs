use super::*;

#[test]
fn a_digest_is_64_lowercase_hex_digits() {
    let digest = "a".repeat(64);
    assert_eq!(
        Sha256Digest::try_new(digest.clone()).unwrap().as_str(),
        digest
    );
    assert!(Sha256Digest::try_new("A".repeat(64)).is_err());
    assert!(Sha256Digest::try_new("a".repeat(63)).is_err());
    assert!(Sha256Digest::try_new("g".repeat(64)).is_err());
}

#[test]
fn file_names_are_the_files_on_disk() {
    let names: Vec<String> = [
        ImageFileName::Vmlinux,
        ImageFileName::RootfsExt4,
        ImageFileName::BootArgs,
    ]
    .iter()
    .map(|name| {
        serde_json::to_value(name)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned()
    })
    .collect();
    assert_eq!(names, ["vmlinux", "rootfs.ext4", "boot_args"]);
    assert_eq!(ImageFileName::RootfsExt4.to_string(), "rootfs.ext4");
}

#[test]
fn a_source_url_is_never_printed() {
    let url = SourceUrl("https://bucket.example/x?X-Amz-Signature=secret".to_owned());
    assert!(!format!("{url:?}").contains("secret"));
}

#[test]
fn states_are_tagged_by_kind() {
    let state = ImageState::Ready { files: None };
    assert_eq!(
        serde_json::to_value(&state).unwrap(),
        serde_json::json!({ "kind": "ready", "files": null })
    );
}

#[test]
fn a_hashers_bytes_become_lowercase_hex() {
    let mut bytes = [0; 32];
    bytes[0] = 0xab;
    bytes[31] = 0x01;
    let digest = Sha256Digest::from_bytes(bytes);
    assert_eq!(Sha256Digest::try_new(digest.as_str()).unwrap(), digest);
    assert!(digest.as_str().starts_with("ab00"));
    assert!(digest.as_str().ends_with("01"));
}
