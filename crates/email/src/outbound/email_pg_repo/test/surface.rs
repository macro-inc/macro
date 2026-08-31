use super::*;
use crate::domain::models::{EmailSurface, UpsertEmailFilterInput};

const LINK_ID: &str = "00000000-0000-0000-0000-000000000e01";
const THREAD_PLAIN_SIGNAL: &str = "00000000-0000-0000-0000-00000000e201";
const THREAD_PROMO_NOISE: &str = "00000000-0000-0000-0000-00000000e202";

async fn list_ids(
    pool: &Pool<Postgres>,
    filter: EmailLiteral,
) -> anyhow::Result<std::collections::HashSet<String>> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let query = Query::new(
        None,
        SimpleSortMethod::UpdatedAt,
        Arc::new(Expr::Literal(filter)),
    );
    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[link_id],
        50,
        &PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        query,
        "",
        None,
    )
    .await?;
    Ok(results.iter().map(|r| r.id.to_string()).collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn unassigned_mail_stays_on_signal_or_noise_not_feed(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sync_all_signal_flags(&pool).await?;

    let signal = list_ids(&pool, EmailLiteral::Importance(true)).await?;
    let noise = list_ids(&pool, EmailLiteral::Importance(false)).await?;
    let feed = list_ids(&pool, EmailLiteral::Feed(true)).await?;

    assert!(signal.contains(THREAD_PLAIN_SIGNAL));
    assert!(!noise.contains(THREAD_PLAIN_SIGNAL));
    assert!(!feed.contains(THREAD_PLAIN_SIGNAL));

    assert!(noise.contains(THREAD_PROMO_NOISE));
    assert!(!signal.contains(THREAD_PROMO_NOISE));
    assert!(!feed.contains(THREAD_PROMO_NOISE));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn assign_sender_to_feed_leaves_signal_and_noise(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("plain@example.com".to_string()),
            email_domain: None,
            is_important: false,
            surface: Some(EmailSurface::Feed),
        },
    )
    .await?;

    let signal = list_ids(&pool, EmailLiteral::Importance(true)).await?;
    let noise = list_ids(&pool, EmailLiteral::Importance(false)).await?;
    let feed = list_ids(&pool, EmailLiteral::Feed(true)).await?;

    assert!(feed.contains(THREAD_PLAIN_SIGNAL));
    assert!(!signal.contains(THREAD_PLAIN_SIGNAL));
    assert!(!noise.contains(THREAD_PLAIN_SIGNAL));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn assign_sender_to_signal_or_noise_leaves_feed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("promo@newsletter.com".to_string()),
            email_domain: None,
            is_important: false,
            surface: Some(EmailSurface::Feed),
        },
    )
    .await?;
    assert!(
        list_ids(&pool, EmailLiteral::Feed(true))
            .await?
            .contains(THREAD_PROMO_NOISE)
    );

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("promo@newsletter.com".to_string()),
            email_domain: None,
            is_important: true,
            surface: Some(EmailSurface::Signal),
        },
    )
    .await?;
    let signal = list_ids(&pool, EmailLiteral::Importance(true)).await?;
    let feed = list_ids(&pool, EmailLiteral::Feed(true)).await?;
    assert!(signal.contains(THREAD_PROMO_NOISE));
    assert!(!feed.contains(THREAD_PROMO_NOISE));

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("promo@newsletter.com".to_string()),
            email_domain: None,
            is_important: false,
            surface: Some(EmailSurface::Noise),
        },
    )
    .await?;
    let noise = list_ids(&pool, EmailLiteral::Importance(false)).await?;
    let feed = list_ids(&pool, EmailLiteral::Feed(true)).await?;
    assert!(noise.contains(THREAD_PROMO_NOISE));
    assert!(!feed.contains(THREAD_PROMO_NOISE));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn deleting_feed_assignment_restores_unassigned_split(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    let filter = repo
        .upsert_email_filter(
            link_id,
            UpsertEmailFilterInput {
                email_address: Some("plain@example.com".to_string()),
                email_domain: None,
                is_important: false,
                surface: Some(EmailSurface::Feed),
            },
        )
        .await?;
    assert!(repo.delete_email_filter(filter.id, link_id).await?);

    let signal = list_ids(&pool, EmailLiteral::Importance(true)).await?;
    let feed = list_ids(&pool, EmailLiteral::Feed(true)).await?;
    assert!(signal.contains(THREAD_PLAIN_SIGNAL));
    assert!(!feed.contains(THREAD_PLAIN_SIGNAL));

    let filter = repo
        .upsert_email_filter(
            link_id,
            UpsertEmailFilterInput {
                email_address: Some("promo@newsletter.com".to_string()),
                email_domain: None,
                is_important: false,
                surface: Some(EmailSurface::Feed),
            },
        )
        .await?;
    assert!(repo.delete_email_filter(filter.id, link_id).await?);

    let noise = list_ids(&pool, EmailLiteral::Importance(false)).await?;
    let feed = list_ids(&pool, EmailLiteral::Feed(true)).await?;
    assert!(noise.contains(THREAD_PROMO_NOISE));
    assert!(!feed.contains(THREAD_PROMO_NOISE));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn address_assignment_beats_domain_feed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: None,
            email_domain: Some("newsletter.com".to_string()),
            is_important: false,
            surface: Some(EmailSurface::Feed),
        },
    )
    .await?;
    assert!(
        list_ids(&pool, EmailLiteral::Feed(true))
            .await?
            .contains(THREAD_PROMO_NOISE)
    );

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("promo@newsletter.com".to_string()),
            email_domain: None,
            is_important: true,
            surface: Some(EmailSurface::Signal),
        },
    )
    .await?;
    let signal = list_ids(&pool, EmailLiteral::Importance(true)).await?;
    let feed = list_ids(&pool, EmailLiteral::Feed(true)).await?;
    assert!(signal.contains(THREAD_PROMO_NOISE));
    assert!(!feed.contains(THREAD_PROMO_NOISE));

    Ok(())
}

async fn list_ordered(
    pool: &Pool<Postgres>,
    filter: Expr<EmailLiteral>,
) -> anyhow::Result<Vec<String>> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, Arc::new(filter));
    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[link_id],
        50,
        &PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        query,
        "",
        None,
    )
    .await?;
    Ok(results.iter().map(|r| r.id.to_string()).collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_signal_flag"))
)]
async fn feed_list_is_newest_first_and_omits_mail_outside_recent_window(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str(LINK_ID)?;

    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("plain@example.com".to_string()),
            email_domain: None,
            is_important: false,
            surface: Some(EmailSurface::Feed),
        },
    )
    .await?;
    repo.upsert_email_filter(
        link_id,
        UpsertEmailFilterInput {
            email_address: Some("promo@newsletter.com".to_string()),
            email_domain: None,
            is_important: false,
            surface: Some(EmailSurface::Feed),
        },
    )
    .await?;

    sqlx::query("UPDATE email_threads SET updated_at = $1 WHERE id = $2")
        .bind(Utc::now() - chrono::Duration::days(20))
        .bind(Uuid::parse_str(THREAD_PROMO_NOISE)?)
        .execute(&pool)
        .await?;

    let recent = list_ordered(
        &pool,
        Expr::and(
            Expr::Literal(EmailLiteral::Feed(true)),
            Expr::Literal(EmailLiteral::UpdatedAt(DateLiteral::GreaterThanOrEqual(
                Utc::now() - chrono::Duration::days(14),
            ))),
        ),
    )
    .await?;
    assert!(recent.contains(&THREAD_PLAIN_SIGNAL.to_string()));
    assert!(!recent.contains(&THREAD_PROMO_NOISE.to_string()));

    let all_feed = list_ordered(&pool, Expr::Literal(EmailLiteral::Feed(true))).await?;
    assert!(all_feed.contains(&THREAD_PLAIN_SIGNAL.to_string()));
    assert!(all_feed.contains(&THREAD_PROMO_NOISE.to_string()));
    let recent_pos = all_feed
        .iter()
        .position(|id| id == THREAD_PLAIN_SIGNAL)
        .expect("recent Feed thread");
    let old_pos = all_feed
        .iter()
        .position(|id| id == THREAD_PROMO_NOISE)
        .expect("old Feed thread");
    assert!(
        recent_pos < old_pos,
        "Feed list should be newest first: {all_feed:?}"
    );

    Ok(())
}
