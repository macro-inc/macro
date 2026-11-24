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

/// Walks the inbox stream from the first thread: the superset never reads
/// first, and each window is one thread per page row.
const WALK: dynamic::OwnedReadTuning = dynamic::OwnedReadTuning {
    superset_limit: -1,
    window_per_row: 1,
    superset_per_need: 0,
    superset_per_walked: 0,
    max_round_window: 2,
    max_superset_cap: 0,
    walk_budget: None,
};

async fn walked(
    pool: &Pool<Postgres>,
    viewer: &str,
    filter: Expr<EmailLiteral>,
    limit: u32,
    tuning: dynamic::OwnedReadTuning,
) -> anyhow::Result<(Vec<String>, Option<dynamic::OwnedReadStats>)> {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, Arc::new(filter));
    let (rows, stats) = dynamic::dynamic_email_thread_cursor_owned_with(
        pool,
        &[Uuid::parse_str(OWN_INBOX)?],
        limit,
        &view,
        query,
        viewer,
        None,
        Some(tuning),
    )
    .await?;
    Ok((rows.iter().map(|r| r.id.to_string()).collect(), stats))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn the_inbox_walk_lists_only_labeled_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let owner = inbox_owner(&pool).await;
    let (rows, stats) = walked(&pool, owner.as_ref(), label(WORK), 10, WALK).await?;
    assert_eq!(rows, vec![thread(6)], "{stats:?}");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn a_spent_walk_budget_says_where_the_list_goes_on(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = inbox_owner(&pool).await;
    // One row a page, windows of one and then two threads, three threads a
    // request: most requests walk past threads without the label.
    let budgeted = dynamic::OwnedReadTuning {
        walk_budget: Some(3),
        ..WALK
    };
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let mut cursor = None;
    let mut listed = Vec::new();
    let mut empty_pages_that_go_on = 0;
    for _ in 0..20 {
        let query = Query::new(
            cursor.take(),
            SimpleSortMethod::UpdatedAt,
            Arc::new(label(WORK)),
        );
        let (rows, stats) = dynamic::dynamic_email_thread_cursor_owned_with(
            &pool,
            &[Uuid::parse_str(OWN_INBOX)?],
            1,
            &view,
            query,
            owner.as_ref(),
            None,
            Some(budgeted),
        )
        .await?;
        let go_on = stats.and_then(|stats| stats.continue_below);
        if rows.is_empty() && go_on.is_some() {
            empty_pages_that_go_on += 1;
        }
        listed.extend(rows.iter().map(|row| row.id.to_string()));
        let next = match (rows.last(), go_on) {
            (_, Some((effective_ts, id))) => Some((id, effective_ts)),
            (Some(row), None) if rows.len() == 1 => Some((row.id, row.sort_ts)),
            _ => None,
        };
        let Some((id, last_val)) = next else {
            break;
        };
        cursor = Some(Cursor {
            id,
            limit: 1,
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val,
            },
            filter: Arc::new(label(WORK)),
        });
    }
    assert_eq!(listed, vec![thread(6)]);
    assert!(
        empty_pages_that_go_on > 0,
        "the budget never cut a page short"
    );
    Ok(())
}
