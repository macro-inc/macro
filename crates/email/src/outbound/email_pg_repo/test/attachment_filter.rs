use super::*;
use item_filters::ast::email::AttachmentKind;
use std::collections::HashSet;

const LINK_ID: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

fn attachment(kind: AttachmentKind) -> Expr<EmailLiteral> {
    Expr::Literal(EmailLiteral::Attachment(kind))
}

fn thread(n: u8) -> String {
    format!("200000{n:02}-0000-0000-0000-0000000000{n:02}")
}

/// Sync every fixture thread's flags the way attachment ingest does.
async fn sync_flags(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    for n in 1..=11 {
        email_db_client::threads::update::sync_thread_attachment_flags(
            &mut conn,
            Uuid::parse_str(&thread(n))?,
        )
        .await?;
    }
    Ok(())
}

async fn all_mail_thread_ids(
    pool: &Pool<Postgres>,
    filter: Expr<EmailLiteral>,
) -> anyhow::Result<HashSet<String>> {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, Arc::new(filter));
    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[Uuid::parse_str(LINK_ID)?],
        50,
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
        scripts(
            "email_dynamic_query",
            "email_dynamic_query_calendar",
            "email_dynamic_query_attachment_kinds"
        )
    )
)]
async fn attachment_kinds_match_threads_by_mime_type(pool: Pool<Postgres>) -> anyhow::Result<()> {
    sync_flags(&pool).await?;

    assert_eq!(
        all_mail_thread_ids(&pool, attachment(AttachmentKind::Pdf)).await?,
        HashSet::from([thread(5), thread(7)])
    );
    assert_eq!(
        all_mail_thread_ids(&pool, attachment(AttachmentKind::Image)).await?,
        HashSet::from([thread(3)])
    );
    assert_eq!(
        all_mail_thread_ids(
            &pool,
            Expr::or(
                attachment(AttachmentKind::Pdf),
                attachment(AttachmentKind::Document)
            )
        )
        .await?,
        HashSet::from([thread(5), thread(6), thread(7)])
    );

    let without_pdfs =
        all_mail_thread_ids(&pool, Expr::is_not(attachment(AttachmentKind::Pdf))).await?;
    assert!(!without_pdfs.contains(&thread(5)));
    assert!(without_pdfs.contains(&thread(6)));
    Ok(())
}
