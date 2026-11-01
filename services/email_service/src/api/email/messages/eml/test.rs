use super::content_disposition;

#[test]
fn content_disposition_carries_ascii_fallback_and_utf8_name() {
    assert_eq!(
        content_disposition("Café plan.eml"),
        "attachment; filename=\"Caf_ plan.eml\"; filename*=UTF-8''Caf%C3%A9%20plan.eml"
    );
}
