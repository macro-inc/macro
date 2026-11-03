use super::*;
use macro_user_id::cowlike::CowLike;
use std::collections::HashSet;

const LINK_ID: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

fn subject(text: &str) -> anyhow::Result<Expr<EmailLiteral>> {
    Ok(Expr::Literal(EmailLiteral::Subject(
        item_filters::ast::email::SubjectQuery::try_from(text.to_owned())?,
    )))
}

async fn all_mail_thread_ids(
    pool: &Pool<Postgres>,
    filter: Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<HashSet<String>> {
    thread_ids(pool, PreviewViewStandardLabel::All, filter, limit).await
}

async fn thread_ids(
    pool: &Pool<Postgres>,
    view: PreviewViewStandardLabel,
    filter: Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<HashSet<String>> {
    let view = PreviewView::StandardLabel(view);
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, Arc::new(filter));
    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[Uuid::parse_str(LINK_ID)?],
        limit,
        &view,
        query,
        "",
        None,
    )
    .await?;
    Ok(results.iter().map(|r| r.id.to_string()).collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_subject")
    )
)]
async fn subject_matches_any_message_ignoring_case(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = all_mail_thread_ids(&pool, subject("fyi")?, 50).await?;

    assert_eq!(
        ids,
        HashSet::from([
            "20000001-0000-0000-0000-000000000001".to_owned(),
            "20000005-0000-0000-0000-000000000005".to_owned(),
            "20000006-0000-0000-0000-000000000006".to_owned(),
        ])
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_subject")
    )
)]
async fn subject_treats_like_wildcards_as_text(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let percent = all_mail_thread_ids(&pool, subject("100%")?, 50).await?;
    assert_eq!(
        percent,
        HashSet::from(["20000004-0000-0000-0000-000000000004".to_owned()])
    );

    let underscore = all_mail_thread_ids(&pool, subject("1_00")?, 50).await?;
    assert!(underscore.is_empty(), "`_` must not match any character");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_subject")
    )
)]
async fn subject_and_sender_must_match_the_same_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let from_john = Expr::Literal(EmailLiteral::Sender(Email::Complete(
        EmailStr::parse_from_str("john@example.com")?.into_owned(),
    )));
    let ids = all_mail_thread_ids(&pool, Expr::and(from_john, subject("fyi")?), 50).await?;

    // Thread 5's FYI message came from jane, not john.
    assert_eq!(
        ids,
        HashSet::from(["20000001-0000-0000-0000-000000000001".to_owned()])
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_subject")
    )
)]
async fn subject_pages_fill_with_matching_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Inbox has no view-level message filter to mirror the lateral, so
    // without a candidate-stage subject filter the one-row candidate page
    // would hold the newest inbox thread, which the lateral then drops.
    let inbox = PreviewViewStandardLabel::Inbox;
    let newest = thread_ids(&pool, inbox, Expr::is_not(subject("100%")?), 1).await?;
    assert!(!newest.contains("20000004-0000-0000-0000-000000000004"));

    let ids = thread_ids(&pool, inbox, subject("100%")?, 1).await?;

    assert_eq!(
        ids,
        HashSet::from(["20000004-0000-0000-0000-000000000004".to_owned()])
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_subject")
    )
)]
async fn negated_subject_keeps_messages_without_a_subject(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let ids = all_mail_thread_ids(&pool, Expr::is_not(subject("fyi")?), 50).await?;

    assert!(ids.contains("20000007-0000-0000-0000-000000000007"));
    assert!(!ids.contains("20000001-0000-0000-0000-000000000001"));
    Ok(())
}
