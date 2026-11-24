use super::*;
use std::collections::HashSet;

const OWN_INBOX: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_INBOX: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const WORK: &str = "10000007-0000-0000-0000-000000000007";
const IMPORTANT: &str = "10000002-0000-0000-0000-000000000002";
const OTHER_INBOX_WORK: &str = "10000101-0000-0000-0000-000000000008";

fn label(id: &str) -> Expr<EmailLiteral> {
    Expr::Literal(EmailLiteral::Label(Uuid::parse_str(id).unwrap()))
}

fn thread(n: u8) -> String {
    format!("200000{n:02}-0000-0000-0000-0000000000{n:02}")
}

async fn listed(
    pool: &Pool<Postgres>,
    inbox: &str,
    viewer: &str,
    filter: Expr<EmailLiteral>,
) -> anyhow::Result<HashSet<String>> {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, Arc::new(filter));
    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[Uuid::parse_str(inbox)?],
        50,
        &view,
        query,
        viewer,
        None,
    )
    .await?;
    Ok(results.iter().map(|r| r.id.to_string()).collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn a_label_lists_the_threads_any_of_whose_messages_carry_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = inbox_owner(&pool).await;
    let owner = owner.as_ref();
    // Thread 11 carries Work too, but sits in Trash, which All mail leaves out.
    assert_eq!(
        listed(&pool, OWN_INBOX, owner, label(WORK)).await?,
        HashSet::from([thread(6)])
    );
    assert_eq!(
        listed(
            &pool,
            OWN_INBOX,
            owner,
            Expr::or(label(WORK), label(IMPORTANT))
        )
        .await?,
        HashSet::from([thread(5), thread(6)])
    );
    let without_work = listed(&pool, OWN_INBOX, owner, Expr::is_not(label(WORK))).await?;
    assert!(!without_work.contains(&thread(6)));
    assert!(without_work.contains(&thread(5)));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_label_readers")
    )
)]
async fn a_label_matches_only_in_inboxes_the_viewer_owns_or_manages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user1 = inbox_owner(&pool).await;
    let user1 = user1.as_ref();
    let delegate = sqlx::query_scalar!(
        "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
        Uuid::parse_str(OTHER_INBOX)?
    )
    .fetch_one(&pool)
    .await?;
    let labeled = "20000102-0000-0000-0000-000000000102".to_string();
    // The delegate manages the other inbox, so its labels filter it.
    assert_eq!(
        listed(&pool, OTHER_INBOX, &delegate, label(OTHER_INBOX_WORK)).await?,
        HashSet::from([labeled.clone()])
    );
    // The thread is listed for user1, who neither owns nor manages that inbox,
    // but that inbox's label never filters it for them.
    let thread_only = Expr::Literal(EmailLiteral::ThreadId(Uuid::parse_str(&labeled)?));
    assert_eq!(
        listed(&pool, OTHER_INBOX, user1, thread_only).await?,
        HashSet::from([labeled])
    );
    assert!(
        listed(&pool, OTHER_INBOX, user1, label(OTHER_INBOX_WORK))
            .await?
            .is_empty()
    );
    Ok(())
}
