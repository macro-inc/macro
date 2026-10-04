use super::*;
use crate::domain::models::{ContactInfo, CreateDraftInput, EmailErr};
use chrono::{TimeZone, Utc};
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn support_intake_matches_exact_recipient_and_excludes_sent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let epoch = Utc.timestamp_opt(0, 0).unwrap();
    let incoming = repo
        .support_mail(link, "BOB@example.com", epoch, Uuid::nil())
        .await?;
    assert_eq!(incoming.len(), 1);
    assert_eq!(incoming[0].email, "alice@example.com");
    assert!(
        repo.support_mail(link, "not-bob@example.com", epoch, Uuid::nil())
            .await?
            .is_empty()
    );
    assert!(
        repo.support_mail(Uuid::new_v4(), "bob@example.com", epoch, Uuid::nil())
            .await?
            .is_empty()
    );
    assert_eq!(
        repo.support_mail(link, "carol@example.com", epoch, Uuid::nil())
            .await?
            .len(),
        1
    );
    assert!(
        repo.support_mail(
            link,
            "bob@example.com",
            incoming[0].created_at,
            incoming[0].id
        )
        .await?
        .is_empty()
    );
    Ok(())
}
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn support_reply_replays_one_send_and_rejects_thread_change(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = super::thread_unread::service(pool.clone());
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link = service
        .email_repo
        .owned_link_for_thread(thread, owner.clone())
        .await?
        .unwrap();
    let request = Uuid::now_v7();
    let mut input = CreateDraftInput {
        db_id: None,
        provider_id: None,
        replying_to_id: Some(Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?),
        provider_thread_id: None,
        thread_db_id: Some(thread),
        subject: "Support reply".into(),
        to: vec![ContactInfo {
            email: "alice@example.com".into(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        body_text: Some("We can help".into()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: Some(false),
        actor: Some(owner),
        draft_client_binding: None,
        thread_client_binding: None,
    };
    for _ in 0..2 {
        service
            .send_support_reply(&link, std::slice::from_ref(&link), request, input.clone())
            .await?;
    }
    let count =
        sqlx::query_scalar!("SELECT COUNT(*) FROM email_messages WHERE subject='Support reply'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(count, Some(1));
    input.thread_db_id = Some(Uuid::parse_str("22222222-2222-2222-2222-222222222222")?);
    assert!(matches!(
        service
            .send_support_reply(&link, std::slice::from_ref(&link), request, input)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    Ok(())
}
