use super::*;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const LINK: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD: &str = "11111111-1111-1111-1111-111111111111";

fn id(value: &str) -> Uuid {
    Uuid::parse_str(value).unwrap()
}

async fn add_message(pool: &PgPool, message: &str, is_draft: bool, recipient: (&str, &str)) {
    let (contact, address) = recipient;
    sqlx::query!(
        "INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)",
        id(contact),
        id(LINK),
        address
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_messages (id, provider_id, thread_id, link_id, internal_date_ts,
            is_read, is_sent, is_draft, has_attachments)
        VALUES ($1, $2, $3, $4, '2025-02-01 00:00:00+00', true, true, $5, false)"#,
        id(message),
        message,
        id(THREAD),
        id(LINK),
        is_draft
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES ($1, $2, 'TO')",
        id(message),
        id(contact)
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_message"))
)]
async fn participants_are_lowercased_distinct_and_skip_drafts(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    add_message(
        &pool,
        "ee000010-0000-0000-0000-000000000010",
        false,
        ("c0000010-0000-0000-0000-000000000010", "Erin@Example.COM"),
    )
    .await;
    add_message(
        &pool,
        "ee000011-0000-0000-0000-000000000011",
        true,
        ("c0000011-0000-0000-0000-000000000011", "dave@example.com"),
    )
    .await;
    let repo = PersonProfilePgRepository(pool);

    assert_eq!(
        repo.thread_participants(id(THREAD), 100).await?,
        [
            "alice@example.com",
            "bob@example.com",
            "carol@example.com",
            "erin@example.com"
        ]
    );
    assert_eq!(repo.thread_participants(id(THREAD), 2).await?.len(), 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn viewer_addresses_are_the_users_inboxes_lowercased(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
        VALUES ($1, 'macro|owner@example.com', 'fa-owner', 'Owner@Example.com', 'GMAIL', true)"#,
        id(LINK)
    )
    .execute(&pool)
    .await?;
    let repo = PersonProfilePgRepository(pool);
    let user = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    assert_eq!(repo.viewer_addresses(&user).await?, ["owner@example.com"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stored_profiles_replace_older_entries_and_respect_freshness(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = PersonProfilePgRepository(pool);
    let ada = PersonProfile {
        email_address: "ada@example.com".into(),
        linkedin_url: Some("https://www.linkedin.com/in/ada".into()),
        headline: Some("Engineer at Acme".into()),
        title: Some("Engineer".into()),
        organization_name: Some("Acme".into()),
        photo_url: Some("https://media.example.com/ada.jpg".into()),
    };
    let miss = PersonProfile::unmatched("noreply@example.com".into());
    let long_ago = Utc::now() - Duration::days(200);
    repo.store_profiles(
        &[
            PersonProfile::unmatched("ada@example.com".into()),
            miss.clone(),
        ],
        long_ago,
    )
    .await?;
    let now = Utc::now();
    repo.store_profiles(std::slice::from_ref(&ada), now).await?;

    let addresses = [
        "ada@example.com".to_string(),
        "noreply@example.com".to_string(),
    ];
    let mut all = repo.stored_profiles(&addresses, long_ago).await?;
    all.sort_by(|a, b| a.email_address.cmp(&b.email_address));
    assert_eq!(all, [ada.clone(), miss]);
    assert_eq!(
        repo.stored_profiles(&addresses, now - Duration::days(1))
            .await?,
        [ada]
    );
    Ok(())
}
