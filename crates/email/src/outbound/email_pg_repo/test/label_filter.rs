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

/// The windows shrink to what is left of the budget, so a request never
/// walks past it.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn a_label_read_walks_no_more_than_its_budget(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let owner = inbox_owner(&pool).await;
    // The labeled thread is the inbox's oldest, so the walk reaches it last.
    sqlx::query!(
        "UPDATE email_threads SET latest_non_spam_message_ts = '2001-01-01 00:00:00+00', updated_at = '2001-01-01 00:00:00+00' WHERE id = $1",
        Uuid::parse_str(&thread(6))?,
    )
    .execute(&pool)
    .await?;
    // Windows of one, two and two threads would walk five.
    let budgeted = dynamic::OwnedReadTuning {
        walk_budget: Some(4),
        ..WALK
    };
    let (rows, stats) = walked(&pool, owner.as_ref(), label(WORK), 1, budgeted).await?;
    let stats = stats.expect("an owned read");
    assert!(rows.is_empty());
    assert_eq!(stats.walked, 4, "{stats:?}");
    assert!(stats.continue_below.is_some(), "{stats:?}");
    Ok(())
}

/// Each window is the newest threads across the viewer's inboxes before the
/// label is tested: an older inbox's labeled thread waits for the window that
/// reaches it, rather than being listed twice.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_label_readers")
    )
)]
async fn an_older_inbox_lists_its_labeled_thread_once(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let owner = inbox_owner(&pool).await;
    let owner = owner.as_ref();
    // The viewer also manages the other inbox, whose threads are older than
    // every thread of their own.
    sqlx::query!(
        "INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) SELECT $1, macro_id, id FROM email_links WHERE id = $2",
        owner,
        Uuid::parse_str(OTHER_INBOX)?,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE email_threads SET latest_non_spam_message_ts = '2001-01-01 00:00:00+00', updated_at = '2001-01-01 00:00:00+00' WHERE link_id = $1",
        Uuid::parse_str(OTHER_INBOX)?,
    )
    .execute(&pool)
    .await?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let inboxes = [Uuid::parse_str(OWN_INBOX)?, Uuid::parse_str(OTHER_INBOX)?];
    let mut cursor = None;
    let mut listed = Vec::new();
    for _ in 0..20 {
        let query = Query::new(
            cursor.take(),
            SimpleSortMethod::UpdatedAt,
            Arc::new(label(OTHER_INBOX_WORK)),
        );
        let (rows, _) = dynamic::dynamic_email_thread_cursor_owned_with(
            &pool,
            &inboxes,
            2,
            &view,
            query,
            owner,
            None,
            Some(WALK),
        )
        .await?;
        listed.extend(rows.iter().map(|row| row.id.to_string()));
        let (Some(last), true) = (rows.last(), rows.len() == 2) else {
            break;
        };
        cursor = Some(Cursor {
            id: last.id,
            limit: 2,
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val: last.sort_ts,
            },
            filter: Arc::new(label(OTHER_INBOX_WORK)),
        });
    }
    assert_eq!(
        listed,
        vec!["20000102-0000-0000-0000-000000000102".to_string()]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn a_label_follows_changes_made_in_macro_before_the_provider_confirms_them(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = inbox_owner(&pool).await;
    let owner = owner.as_ref();
    // Both reads: the label's own rows first, and the inbox walk.
    let lists = |pool: Pool<Postgres>| async move {
        let from_label = listed(&pool, OWN_INBOX, owner, label(WORK)).await?;
        let (walking, _) = walked(&pool, owner, label(WORK), 10, WALK).await?;
        anyhow::Ok((from_label, walking.into_iter().collect::<HashSet<_>>()))
    };
    let command = Uuid::from_u128(0xc0);
    sqlx::query!(
        "INSERT INTO email_mailbox_commands (id, link_id, generation, actor_id, intent, status) VALUES ($1, $2, 1, $3, '{}'::jsonb, 'pending')",
        command,
        Uuid::parse_str(OWN_INBOX)?,
        owner,
    )
    .execute(&pool)
    .await?;

    // Put on in Macro: thread 5's message carries Work before Gmail says so.
    sqlx::query!(
        "INSERT INTO email_pending_mailbox_state (message_id, attribute, command_id, desired) VALUES ('30000005-0000-0000-0000-000000000005', 'tag:Label_Work', $1, 'true'::jsonb)",
        command,
    )
    .execute(&pool)
    .await?;
    let both = HashSet::from([thread(5), thread(6)]);
    assert_eq!(lists(pool.clone()).await?, (both.clone(), both));

    // Taken off in Macro: thread 6 no longer carries it.
    sqlx::query!(
        "INSERT INTO email_pending_mailbox_state (message_id, attribute, command_id, desired) VALUES ('30000006-0000-0000-0000-000000000006', 'tag:Label_Work', $1, 'false'::jsonb)",
        command,
    )
    .execute(&pool)
    .await?;
    let five = HashSet::from([thread(5)]);
    assert_eq!(lists(pool.clone()).await?, (five.clone(), five));

    // A label being deleted matches nothing.
    sqlx::query!(
        "INSERT INTO email_mailbox_settings_work (id, link_id, kind, resource_key, revision, completed_revision) VALUES ($1, $2, 'delete_label', 'Label_Work', 2, 1)",
        Uuid::from_u128(0xd0),
        Uuid::parse_str(OWN_INBOX)?,
    )
    .execute(&pool)
    .await?;
    assert_eq!(lists(pool.clone()).await?, (HashSet::new(), HashSet::new()));
    Ok(())
}
