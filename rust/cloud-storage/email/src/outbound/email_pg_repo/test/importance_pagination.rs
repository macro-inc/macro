use super::*;

// Pagination for email queries filtered by a per-message attribute
// (importance). A page must contain up to `limit` threads that actually match
// the filter, the cursor must advance across pages without repeating threads,
// an exhausted result must report no further pages, and an all-inboxes query
// must return the union of its per-inbox results.

fn importance_exclude_filter() -> Arc<Expr<EmailLiteral>> {
    Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::Importance(true)),
        Expr::Literal(EmailLiteral::Shared(
            item_filters::SharedEmailFilter::Exclude,
        )),
    ))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_importance_pagination"))
)]
async fn test_importance_inbox_pagination_fills_page_and_advances_cursor(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("a1111111-1111-1111-1111-111111111111")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 3;

    // Link 1 has 3 recent non-important + 4 older important inbox threads.
    // With limit=3 the first page must be a full page of the 3 most-recent
    // important threads; the recent non-important threads must not occupy the
    // limit.
    let query = Query::new(
        None,
        SimpleSortMethod::UpdatedAt,
        importance_exclude_filter(),
    );
    let page1 =
        dynamic::dynamic_email_thread_cursor(&pool, &[link_id], limit, &view, query, "", None)
            .await?;

    let page1_ids: Vec<String> = page1.iter().map(|r| r.id.to_string()).collect();
    assert_eq!(
        page1_ids,
        vec![
            "2a000004-0000-0000-0000-000000000004".to_string(),
            "2a000005-0000-0000-0000-000000000005".to_string(),
            "2a000006-0000-0000-0000-000000000006".to_string(),
        ],
        "first page should be a full page of the 3 most-recent important threads"
    );

    // Second page: the cursor advances onto the 4th important thread.
    let last = page1.last().unwrap();
    let cursor = Cursor {
        id: last.id,
        limit: limit as usize,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: last.sort_ts,
        },
        filter: importance_exclude_filter(),
    };
    let query2 = Query::new(
        Some(cursor),
        SimpleSortMethod::UpdatedAt,
        importance_exclude_filter(),
    );
    let page2 =
        dynamic::dynamic_email_thread_cursor(&pool, &[link_id], limit, &view, query2, "", None)
            .await?;

    let page2_ids: Vec<String> = page2.iter().map(|r| r.id.to_string()).collect();
    assert_eq!(
        page2_ids,
        vec!["2a000007-0000-0000-0000-000000000007".to_string()],
        "second page should hold the remaining important thread"
    );

    // Third page: cursor is exhausted, no rows remain.
    let last2 = page2.last().unwrap();
    let cursor2 = Cursor {
        id: last2.id,
        limit: limit as usize,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: last2.sort_ts,
        },
        filter: importance_exclude_filter(),
    };
    let query3 = Query::new(
        Some(cursor2),
        SimpleSortMethod::UpdatedAt,
        importance_exclude_filter(),
    );
    let page3 =
        dynamic::dynamic_email_thread_cursor(&pool, &[link_id], limit, &view, query3, "", None)
            .await?;
    assert!(
        page3.is_empty(),
        "pagination should terminate once important threads are exhausted"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_importance_pagination"))
)]
async fn test_importance_inbox_underfilled_page_has_no_more(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("a1111111-1111-1111-1111-111111111111")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;

    // All importance-matching threads on link 1 sit below the limit, so the
    // page holds exactly them (non-matching threads excluded) and a follow-up
    // cursor page is empty — `len < limit` means last page, so no cursor.
    let query = Query::new(
        None,
        SimpleSortMethod::UpdatedAt,
        importance_exclude_filter(),
    );
    let page =
        dynamic::dynamic_email_thread_cursor(&pool, &[link_id], limit, &view, query, "", None)
            .await?;

    assert_eq!(
        page.len(),
        4,
        "should return exactly the 4 important threads"
    );
    assert!(
        page.len() < limit as usize,
        "page is under the limit, so the caller treats it as the last page"
    );

    let last = page.last().unwrap();
    let cursor = Cursor {
        id: last.id,
        limit: limit as usize,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: last.sort_ts,
        },
        filter: importance_exclude_filter(),
    };
    let query2 = Query::new(
        Some(cursor),
        SimpleSortMethod::UpdatedAt,
        importance_exclude_filter(),
    );
    let next =
        dynamic::dynamic_email_thread_cursor(&pool, &[link_id], limit, &view, query2, "", None)
            .await?;
    assert!(
        next.is_empty(),
        "no further pages once all important threads are returned"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_importance_pagination"))
)]
async fn test_importance_pagination_multi_inbox_counts_agree(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link1 = Uuid::parse_str("a1111111-1111-1111-1111-111111111111")?;
    let link2 = Uuid::parse_str("b2222222-2222-2222-2222-222222222222")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;

    let single1 = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[link1],
        limit,
        &view,
        Query::new(
            None,
            SimpleSortMethod::UpdatedAt,
            importance_exclude_filter(),
        ),
        "",
        None,
    )
    .await?;
    let single2 = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[link2],
        limit,
        &view,
        Query::new(
            None,
            SimpleSortMethod::UpdatedAt,
            importance_exclude_filter(),
        ),
        "",
        None,
    )
    .await?;
    let multi = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[link1, link2],
        limit,
        &view,
        Query::new(
            None,
            SimpleSortMethod::UpdatedAt,
            importance_exclude_filter(),
        ),
        "",
        None,
    )
    .await?;

    assert_eq!(single1.len(), 4, "link 1 has 4 important inbox threads");
    assert_eq!(single2.len(), 2, "link 2 has 2 important inbox threads");
    assert_eq!(
        multi.len(),
        single1.len() + single2.len(),
        "all-inboxes count must equal the sum of the per-inbox counts"
    );

    // The all-inboxes page is exactly the union of both links' threads.
    let multi_ids: std::collections::HashSet<String> =
        multi.iter().map(|r| r.id.to_string()).collect();
    for r in single1.iter().chain(single2.iter()) {
        assert!(
            multi_ids.contains(&r.id.to_string()),
            "multi-inbox page missing thread {}",
            r.id
        );
    }

    Ok(())
}
