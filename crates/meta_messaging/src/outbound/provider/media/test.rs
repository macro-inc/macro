use super::*;

#[test]
fn media_downloads_cannot_target_internal_or_lookalike_hosts() {
    for url in [
        "http://scontent.fbcdn.net/a",
        "https://localhost/a",
        "https://127.0.0.1/a",
        "https://fbcdn.net.attacker.example/a",
        "https://user:secret@scontent.fbcdn.net/a",
        "https://scontent.fbcdn.net:444/a",
    ] {
        assert!(!allowed_media_url(&Url::parse(url).unwrap()), "{url}");
    }
    assert!(allowed_media_url(
        &Url::parse("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123").unwrap()
    ));
    assert!(allowed_media_url(
        &Url::parse("https://scontent.cdninstagram.com/image.jpg").unwrap()
    ));
}

#[test]
fn media_checksum_accepts_exact_hex_or_base64_digest_only() {
    let bytes = b"fixture media";
    let digest = Sha256::digest(bytes);
    let hex = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let base64 = base64::engine::general_purpose::STANDARD.encode(digest);
    assert!(checksum_matches(&hex, bytes));
    assert!(checksum_matches(&base64, bytes));
    assert!(!checksum_matches(&hex, b"different"));
    assert!(!checksum_matches("invalid", bytes));
}

#[test]
fn incoming_media_uses_a_safe_name_when_the_provider_name_is_blank() {
    for name in [None, Some(""), Some("   "), Some("../photo.png")] {
        assert_eq!(media_filename(name, "png"), "attachment.png");
    }
    assert_eq!(media_filename(Some("photo.png"), "png"), "photo.png");
}
