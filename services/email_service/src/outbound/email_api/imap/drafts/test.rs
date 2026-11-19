use super::*;

#[test]
fn uploads_cannot_cross_mailbox_bindings_or_become_http_targets() {
    let mailbox = MailboxKey {
        link_id: Uuid::from_u128(1),
        sync_generation: 1,
        grant_generation: 1,
    };
    let other = MailboxKey {
        link_id: Uuid::from_u128(2),
        sync_generation: 1,
        grant_generation: 1,
    };
    let session = upload(
        mailbox,
        models::UploadSession {
            id: Uuid::from_u128(3),
            expires_at: chrono::Utc::now(),
            next_offset: 0,
            attachment: None,
        },
    );
    assert_eq!(
        upload_id(mailbox, &session.url).unwrap(),
        Uuid::from_u128(3)
    );
    assert_eq!(
        upload_id(other, &session.url),
        Err(EmailApiError::Forbidden)
    );
    assert_eq!(
        upload_id(
            mailbox,
            &UploadUrl::new("https://169.254.169.254/latest/meta-data".into())
        ),
        Err(EmailApiError::Forbidden)
    );
}
