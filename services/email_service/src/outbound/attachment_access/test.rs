use super::*;

#[test]
fn oversized_provider_content_preserves_its_permanent_content_limit() {
    let provider = crate::outbound::email_api::imap::error(
        imap_engine::domain::models::Error::MessageTooLarge,
    );
    assert!(!provider.is_transient());
    assert!(matches!(
        provider_error(provider),
        AttachmentError::ContentTooLarge
    ));
}
