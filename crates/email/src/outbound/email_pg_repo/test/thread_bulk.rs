use super::thread_unread::service;
use super::*;
use crate::domain::models::{
    BulkThreadAction, BulkThreadActionResult, BulkThreadCursor, BulkThreadQuery, BulkThreadStart,
    BulkThreadTarget, BulkThreadTargetsPage, BulkThreadTargetsRequest, EmailErr,
};
use crate::domain::ports::EmailBulkThreadService;
use item_filters::SharedEmailFilter;

// email_importance_pagination: user1's inbox holds three Noise threads and,
// below them, four Signal threads, newest first. Another user owns 2b….
const NOISE_1: Uuid = Uuid::from_u128(0x2a000001_0000_0000_0000_000000000001);
const NOISE_2: Uuid = Uuid::from_u128(0x2a000002_0000_0000_0000_000000000002);
const NOISE_3: Uuid = Uuid::from_u128(0x2a000003_0000_0000_0000_000000000003);
const SIGNAL_1: Uuid = Uuid::from_u128(0x2a000004_0000_0000_0000_000000000004);
const SIGNAL_2: Uuid = Uuid::from_u128(0x2a000005_0000_0000_0000_000000000005);
const SIGNAL_3: Uuid = Uuid::from_u128(0x2a000006_0000_0000_0000_000000000006);
const SIGNAL_4: Uuid = Uuid::from_u128(0x2a000007_0000_0000_0000_000000000007);
const OTHER_USERS_THREAD: Uuid = Uuid::from_u128(0x2b000001_0000_0000_0000_000000000001);

/// The Email view's Signal or Noise query.
fn inbox_tab(important: bool) -> BulkThreadQuery {
    BulkThreadQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        filter: Some(Arc::new(Expr::and(
            Expr::Literal(EmailLiteral::Importance(important)),
            Expr::Literal(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
        ))),
    }
}

async fn list(
    service: &impl EmailBulkThreadService,
    query: BulkThreadQuery,
    start: BulkThreadStart,
    limit: u32,
) -> Result<BulkThreadTargetsPage, EmailErr> {
    service
        .list_bulk_thread_targets(
            MacroUserIdStr::try_from_email("user1@test.com").unwrap(),
            BulkThreadTargetsRequest {
                query,
                start,
                limit,
            },
        )
        .await
}

fn ids(page: &BulkThreadTargetsPage) -> Vec<Uuid> {
    page.threads.iter().map(|thread| thread.id).collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_importance_pagination", "email_thread_bulk")
    )
)]
async fn select_all_below_starts_at_the_row_and_reaches_every_older_thread_in_the_tab(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sync_all_signal_flags(&pool).await?;
    let service = service(pool);

    let page = list(
        &service,
        inbox_tab(true),
        BulkThreadStart::FromThread(SIGNAL_2),
        500,
    )
    .await?;

    assert_eq!(
        page,
        BulkThreadTargetsPage {
            threads: vec![
                BulkThreadTarget {
                    id: SIGNAL_2,
                    done: false,
                    read: false,
                    sort_ts: Utc.with_ymd_and_hms(2024, 2, 6, 10, 0, 0).unwrap(),
                },
                BulkThreadTarget {
                    id: SIGNAL_3,
                    done: false,
                    read: false,
                    sort_ts: Utc.with_ymd_and_hms(2024, 2, 5, 10, 0, 0).unwrap(),
                },
                BulkThreadTarget {
                    id: SIGNAL_4,
                    done: false,
                    read: false,
                    sort_ts: Utc.with_ymd_and_hms(2024, 2, 4, 10, 0, 0).unwrap(),
                },
            ],
            next: None,
        }
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_importance_pagination", "email_thread_bulk")
    )
)]
async fn pages_continue_after_the_cursor_without_repeating_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sync_all_signal_flags(&pool).await?;
    let service = service(pool);

    let first = list(
        &service,
        inbox_tab(true),
        BulkThreadStart::FromThread(SIGNAL_1),
        3,
    )
    .await?;
    assert_eq!(ids(&first), vec![SIGNAL_1, SIGNAL_2, SIGNAL_3]);
    assert_eq!(
        first.next,
        Some(BulkThreadCursor {
            thread_id: SIGNAL_3,
            sort_ts: Utc.with_ymd_and_hms(2024, 2, 5, 10, 0, 0).unwrap(),
        })
    );

    let second = list(
        &service,
        inbox_tab(true),
        BulkThreadStart::After(first.next.unwrap()),
        3,
    )
    .await?;
    assert_eq!(ids(&second), vec![SIGNAL_4]);
    assert_eq!(second.next, None);

    // A page that ends exactly at the last thread is the last page.
    let exact = list(
        &service,
        inbox_tab(true),
        BulkThreadStart::FromThread(SIGNAL_2),
        3,
    )
    .await?;
    assert_eq!(ids(&exact), vec![SIGNAL_2, SIGNAL_3, SIGNAL_4]);
    assert_eq!(exact.next, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_importance_pagination", "email_thread_bulk")
    )
)]
async fn select_all_in_the_view_starts_at_the_top_of_the_tab(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sync_all_signal_flags(&pool).await?;
    let service = service(pool);

    let page = list(&service, inbox_tab(false), BulkThreadStart::Top, 500).await?;

    assert_eq!(ids(&page), vec![NOISE_1, NOISE_2, NOISE_3]);
    assert_eq!(page.next, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_importance_pagination", "email_thread_bulk")
    )
)]
async fn an_anchor_outside_the_tab_or_the_callers_inboxes_is_not_found(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sync_all_signal_flags(&pool).await?;
    let service = service(pool);

    for anchor in [NOISE_1, OTHER_USERS_THREAD] {
        let result = list(
            &service,
            inbox_tab(true),
            BulkThreadStart::FromThread(anchor),
            500,
        )
        .await;
        assert!(
            matches!(result, Err(EmailErr::ThreadNotFound)),
            "{anchor} should not anchor a Signal selection, got {result:?}"
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_importance_pagination", "email_thread_bulk")
    )
)]
async fn bulk_done_is_repeatable_undoable_and_skips_threads_the_caller_cannot_change(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sync_all_signal_flags(&pool).await?;
    let service = service(pool);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;

    let archived = service
        .apply_bulk_thread_action(
            owner.clone(),
            vec![SIGNAL_2, OTHER_USERS_THREAD, SIGNAL_3],
            BulkThreadAction::Archive,
        )
        .await;
    assert_eq!(
        archived,
        BulkThreadActionResult {
            succeeded_ids: vec![SIGNAL_2, SIGNAL_3],
            failed_ids: vec![OTHER_USERS_THREAD],
        }
    );
    let signal = list(&service, inbox_tab(true), BulkThreadStart::Top, 500).await?;
    assert_eq!(ids(&signal), vec![SIGNAL_1, SIGNAL_4]);
    assert!(
        service
            .email_repo
            .thread_by_id(OTHER_USERS_THREAD)
            .await?
            .unwrap()
            .inbox_visible
    );

    // All still lists archived threads, now marked done.
    let all = list(
        &service,
        BulkThreadQuery {
            view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            filter: None,
        },
        BulkThreadStart::FromThread(SIGNAL_2),
        500,
    )
    .await?;
    assert_eq!(
        all.threads
            .iter()
            .map(|thread| (thread.id, thread.done))
            .collect::<Vec<_>>(),
        vec![(SIGNAL_2, true), (SIGNAL_3, true), (SIGNAL_4, false)]
    );

    let repeated = service
        .apply_bulk_thread_action(
            owner.clone(),
            vec![SIGNAL_2, SIGNAL_3],
            BulkThreadAction::Archive,
        )
        .await;
    assert_eq!(repeated.succeeded_ids, vec![SIGNAL_2, SIGNAL_3]);
    assert!(repeated.failed_ids.is_empty());

    let restored = service
        .apply_bulk_thread_action(owner, vec![SIGNAL_2, SIGNAL_3], BulkThreadAction::Unarchive)
        .await;
    assert_eq!(restored.succeeded_ids, vec![SIGNAL_2, SIGNAL_3]);
    let signal = list(&service, inbox_tab(true), BulkThreadStart::Top, 500).await?;
    assert_eq!(ids(&signal), vec![SIGNAL_1, SIGNAL_2, SIGNAL_3, SIGNAL_4]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_importance_pagination", "email_thread_bulk")
    )
)]
async fn bulk_mark_read_and_its_undo_toggle_only_the_listed_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sync_all_signal_flags(&pool).await?;
    let service = service(pool);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let read_states = |page: BulkThreadTargetsPage| {
        page.threads
            .into_iter()
            .map(|thread| (thread.id, thread.read))
            .collect::<Vec<_>>()
    };

    let read = service
        .apply_bulk_thread_action(
            owner.clone(),
            vec![SIGNAL_1, SIGNAL_2],
            BulkThreadAction::MarkRead,
        )
        .await;
    assert_eq!(read.succeeded_ids, vec![SIGNAL_1, SIGNAL_2]);
    assert_eq!(
        read_states(list(&service, inbox_tab(true), BulkThreadStart::Top, 500).await?),
        vec![
            (SIGNAL_1, true),
            (SIGNAL_2, true),
            (SIGNAL_3, false),
            (SIGNAL_4, false),
        ]
    );

    for _ in 0..2 {
        let unread = service
            .apply_bulk_thread_action(
                owner.clone(),
                vec![SIGNAL_1, SIGNAL_2],
                BulkThreadAction::MarkUnread,
            )
            .await;
        assert_eq!(unread.succeeded_ids, vec![SIGNAL_1, SIGNAL_2]);
    }
    assert_eq!(
        read_states(list(&service, inbox_tab(true), BulkThreadStart::Top, 500).await?),
        vec![
            (SIGNAL_1, false),
            (SIGNAL_2, false),
            (SIGNAL_3, false),
            (SIGNAL_4, false),
        ]
    );
    Ok(())
}
