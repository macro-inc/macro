use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_inbox_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;
    // Use a broad filter that matches most emails
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get inbox messages (threads 1, 4, 5, 7)
    assert_eq!(
        results.len(),
        4,
        "Inbox view should return 4 threads with inbox_visible=true"
    );

    // Verify thread 1 is in results
    assert!(
        results
            .iter()
            .any(|r| r.id.to_string() == "20000001-0000-0000-0000-000000000001"),
        "Should include inbox thread 1"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_sent_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get sent messages (thread 2)
    assert_eq!(results.len(), 1, "Sent view should return 1 thread");
    assert_eq!(
        results[0].id.to_string(),
        "20000002-0000-0000-0000-000000000002"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_drafts_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get draft messages (threads 3 and 8)
    assert_eq!(results.len(), 2, "Drafts view should return 2 threads");
    assert!(
        results.iter().all(|r| r.is_draft),
        "All messages should be drafts"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_starred_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Starred);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get starred messages (thread 4)
    assert_eq!(results.len(), 1, "Starred view should return 1 thread");
    assert_eq!(
        results[0].id.to_string(),
        "20000004-0000-0000-0000-000000000004"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_important_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Important);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get important messages and drafts (threads 3, 5, and 8)
    assert_eq!(results.len(), 3, "Important view should return 3 threads");

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        result_ids.contains("20000003-0000-0000-0000-000000000003"),
        "Should include draft thread 3"
    );
    assert!(
        result_ids.contains("20000005-0000-0000-0000-000000000005"),
        "Should include important thread 5"
    );
    assert!(
        result_ids.contains("20000008-0000-0000-0000-000000000008"),
        "Should include draft thread 8"
    );
    assert!(results.iter().all(|r| r.is_important));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_static_important_query_includes_drafts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let limit = 50;
    let query = Query::Sort(SimpleSortMethod::UpdatedAt, ());

    let results =
        preview_views::important::important_preview_cursor(&pool, &link_id, limit, &query).await?;

    assert_eq!(
        results.len(),
        3,
        "Static important query should return important and draft threads"
    );

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        result_ids.contains("20000003-0000-0000-0000-000000000003"),
        "Should include draft thread 3"
    );
    assert!(
        result_ids.contains("20000005-0000-0000-0000-000000000005"),
        "Should include important thread 5"
    );
    assert!(
        result_ids.contains("20000008-0000-0000-0000-000000000008"),
        "Should include draft thread 8"
    );
    assert!(results.iter().all(|r| r.is_important));
    assert!(results.iter().any(|r| r.is_draft));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_user_label_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::UserLabel("Work".to_string());
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get messages with "Work" label (thread 6)
    assert_eq!(results.len(), 1, "User label view should return 1 thread");
    assert_eq!(
        results[0].id.to_string(),
        "20000006-0000-0000-0000-000000000006"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_sender_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for emails from john@example.com
    let email_filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Complete(
        EmailStr::parse_from_str("john@example.com")?.into_owned(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get messages from john@example.com (threads 1, 2, 5)
    assert!(
        results.len() >= 2,
        "Should return at least 2 threads from john@example.com"
    );

    // Verify sender is john@example.com for applicable threads
    for result in &results {
        if let Some(sender) = &result.sender_email {
            assert_eq!(sender, "john@example.com");
        }
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_partial_sender_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for emails from anyone at example.com
    let email_filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get all messages since all contacts are from example.com
    assert!(
        results.len() >= 5,
        "Should return multiple threads from example.com domain"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_recipient_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for emails to alice@example.com
    let email_filter = Arc::new(Expr::Literal(EmailLiteral::Recipient(Email::Complete(
        EmailStr::parse_from_str("alice@example.com")?.into_owned(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get messages to alice@example.com (threads 1, 3, 5, 7)
    assert!(
        results.len() >= 3,
        "Should return threads sent to alice@example.com"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_cc_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for emails with bob@example.com in CC
    let email_filter = Arc::new(Expr::Literal(EmailLiteral::Cc(Email::Complete(
        EmailStr::parse_from_str("bob@example.com")?.into_owned(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get messages with bob@example.com in CC (thread 7)
    assert_eq!(results.len(), 1, "Should return 1 thread with CC to bob");
    assert_eq!(
        results[0].id.to_string(),
        "20000007-0000-0000-0000-000000000007"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_inbox_with_sender_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;

    // Combine Inbox view with sender filter
    let email_filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Complete(
        EmailStr::parse_from_str("john@example.com")?.into_owned(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get inbox messages from john@example.com (threads 1, 5)
    assert_eq!(
        results.len(),
        2,
        "Should return 2 inbox threads from john@example.com"
    );

    // Verify all results are from john and in inbox
    for result in &results {
        assert!(result.inbox_visible, "Should be inbox visible");
        if let Some(sender) = &result.sender_email {
            assert_eq!(sender, "john@example.com");
        }
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_drafts_with_recipient_filter(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts);
    let limit = 50;

    // Combine Drafts view with recipient filter
    let email_filter = Arc::new(Expr::Literal(EmailLiteral::Recipient(Email::Complete(
        EmailStr::parse_from_str("alice@example.com")?.into_owned(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get draft messages to alice@example.com (threads 3 and 8)
    assert_eq!(
        results.len(),
        2,
        "Should return 2 draft threads to alice@example.com"
    );
    assert!(results.iter().all(|r| r.is_draft), "All should be drafts");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_and_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for emails from john@example.com AND to alice@example.com
    let email_filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
        Expr::Literal(EmailLiteral::Recipient(Email::Complete(
            EmailStr::parse_from_str("alice@example.com")?.into_owned(),
        ))),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get messages from john to alice (threads 1, 5)
    assert!(
        results.len() >= 1,
        "Should return threads from john to alice"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_or_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for emails from john@example.com OR jane@example.com
    let email_filter = Arc::new(Expr::or(
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("jane@example.com")?.into_owned(),
        ))),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Should get messages from john or jane
    assert!(
        results.len() >= 3,
        "Should return threads from john or jane"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 2;

    // First page with limit 2
    let filter1 = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter1);
    let first_page =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    assert_eq!(first_page.len(), 2, "Should return 2 results");

    // Get the cursor from the last item
    let last_item = first_page.last().unwrap();
    let cursor_ts = last_item.sort_ts;
    let cursor_id = last_item.id;

    // Second page using cursor
    let filter2 = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let filter3 = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    ))));
    let cursor = Cursor {
        id: cursor_id,
        limit: 2,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: cursor_ts,
        },
        filter: filter2,
    };
    let query2 = Query::new(Some(cursor), SimpleSortMethod::UpdatedAt, filter3);
    let second_page =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query2).await?;

    assert!(
        second_page.len() > 0,
        "Should return additional results on second page"
    );

    // Verify no overlap between pages
    let first_ids: Vec<_> = first_page.iter().map(|r| r.id).collect();
    for result in &second_page {
        assert!(
            !first_ids.contains(&result.id),
            "Second page should not contain IDs from first page"
        );
    }

    Ok(())
}

// Test filtering emails by importance
// The fixture has:
//   Thread 1 (msg 1): INBOX + CATEGORY_PERSONAL → important (has priority label)
//   Thread 2 (msg 2): SENT → important (has priority label)
//   Thread 3 (msg 3): DRAFT → important (DRAFT is a priority label)
//   Thread 4 (msg 4): STARRED + INBOX → important (no depriority label)
//   Thread 5 (msg 5): IMPORTANT + INBOX → important (no depriority label)
//   Thread 6 (msg 6): Work + CATEGORY_UPDATES → NOT important (depriority, no priority)
//   Thread 7 (msg 7): INBOX + CATEGORY_PROMOTIONS → NOT important (depriority, no priority)
//   Thread 8 (msg 8): DRAFT + CATEGORY_UPDATES → important (DRAFT priority overrides depriority)
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_importance_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // importance=true: threads with priority labels OR without depriority labels
    {
        let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(true)));
        let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

        let results =
            dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

        // Threads 1 (CATEGORY_PERSONAL), 2 (SENT), 3 (DRAFT), 4 (no depriority), 5 (no depriority), 8 (DRAFT overrides depriority)
        assert_eq!(
            results.len(),
            6,
            "importance=true should return 6 important threads"
        );

        let result_ids: std::collections::HashSet<String> =
            results.iter().map(|r| r.id.to_string()).collect();

        assert!(
            result_ids.contains("20000001-0000-0000-0000-000000000001"),
            "Should include thread 1 (CATEGORY_PERSONAL)"
        );
        assert!(
            result_ids.contains("20000002-0000-0000-0000-000000000002"),
            "Should include thread 2 (SENT)"
        );
        assert!(
            result_ids.contains("20000003-0000-0000-0000-000000000003"),
            "Should include thread 3 (DRAFT)"
        );
        assert!(
            result_ids.contains("20000004-0000-0000-0000-000000000004"),
            "Should include thread 4 (no depriority)"
        );
        assert!(
            result_ids.contains("20000005-0000-0000-0000-000000000005"),
            "Should include thread 5 (no depriority)"
        );
        assert!(
            result_ids.contains("20000008-0000-0000-0000-000000000008"),
            "Should include thread 8 (DRAFT overrides CATEGORY_UPDATES depriority)"
        );

        // Threads 6 and 7 should be excluded (depriority labels, no priority)
        assert!(
            !result_ids.contains("20000006-0000-0000-0000-000000000006"),
            "Should exclude thread 6 (CATEGORY_UPDATES)"
        );
        assert!(
            !result_ids.contains("20000007-0000-0000-0000-000000000007"),
            "Should exclude thread 7 (CATEGORY_PROMOTIONS)"
        );
    }

    // importance=false: threads with depriority labels AND without priority labels
    {
        let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(false)));
        let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

        let results =
            dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

        // Threads 6 (CATEGORY_UPDATES) and 7 (CATEGORY_PROMOTIONS)
        // Thread 8 has CATEGORY_UPDATES but is excluded because DRAFT is a priority label
        assert_eq!(
            results.len(),
            2,
            "importance=false should return 2 unimportant threads (drafts excluded)"
        );

        let result_ids: std::collections::HashSet<String> =
            results.iter().map(|r| r.id.to_string()).collect();

        assert!(
            result_ids.contains("20000006-0000-0000-0000-000000000006"),
            "Should include thread 6 (CATEGORY_UPDATES)"
        );
        assert!(
            result_ids.contains("20000007-0000-0000-0000-000000000007"),
            "Should include thread 7 (CATEGORY_PROMOTIONS)"
        );
        assert!(
            !result_ids.contains("20000008-0000-0000-0000-000000000008"),
            "Should exclude thread 8 (DRAFT priority overrides CATEGORY_UPDATES depriority)"
        );
    }

    Ok(())
}

// ── Project ID filter tests ──────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_single_project_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for threads in Project Alpha
    let filter = Arc::new(Expr::Literal(EmailLiteral::ProjectId(
        "proj-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
    )));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Threads 1, 2, 5 are in Project Alpha
    assert_eq!(results.len(), 3, "Should return 3 threads in Project Alpha");

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(result_ids.contains("20000001-0000-0000-0000-000000000001"));
    assert!(result_ids.contains("20000002-0000-0000-0000-000000000002"));
    assert!(result_ids.contains("20000005-0000-0000-0000-000000000005"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_multiple_project_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for threads in Project Alpha OR Project Beta
    let filter = Arc::new(Expr::or(
        Expr::Literal(EmailLiteral::ProjectId(
            "proj-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
        )),
        Expr::Literal(EmailLiteral::ProjectId(
            "proj-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        )),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Threads 1, 2, 5 (Alpha) + Thread 6 (Beta)
    assert_eq!(
        results.len(),
        4,
        "Should return 4 threads across both projects"
    );

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(result_ids.contains("20000006-0000-0000-0000-000000000006"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_project_id_with_sender_filter(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Filter for threads in Project Alpha AND from john@example.com
    // Threads 1 and 5 are in Alpha and from john; thread 2 is in Alpha but from john (sent)
    let filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::ProjectId(
            "proj-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
        )),
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // All results should be in Project Alpha and from john
    for result in &results {
        if let Some(sender) = &result.sender_email {
            assert_eq!(sender, "john@example.com");
        }
    }
    assert!(
        results.len() >= 2,
        "Should return threads in Project Alpha from john"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_project_id_with_inbox_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;

    // Filter for inbox threads in Project Alpha
    // Thread 1 and 5 are inbox + Alpha; thread 2 is Alpha but not inbox
    let filter = Arc::new(Expr::Literal(EmailLiteral::ProjectId(
        "proj-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
    )));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    assert_eq!(
        results.len(),
        2,
        "Should return 2 inbox threads in Project Alpha"
    );

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(result_ids.contains("20000001-0000-0000-0000-000000000001"));
    assert!(result_ids.contains("20000005-0000-0000-0000-000000000005"));
    // Thread 2 is in Alpha but not inbox
    assert!(!result_ids.contains("20000002-0000-0000-0000-000000000002"));

    Ok(())
}

// Inbox view + importance=false: the "Other" toggle in the UI.
// Thread 6 (CATEGORY_UPDATES) has importance=false but inbox_visible=false → excluded by Inbox view.
// Thread 7 (CATEGORY_PROMOTIONS) has importance=false AND inbox_visible=true → included.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_inbox_view_with_importance_false(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(false)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    // Only thread 7: inbox_visible=true AND importance=false
    assert_eq!(
        results.len(),
        1,
        "Inbox view with importance=false should return only 1 thread"
    );

    assert_eq!(
        results[0].id.to_string(),
        "20000007-0000-0000-0000-000000000007",
        "Should be thread 7 (CATEGORY_PROMOTIONS, inbox_visible=true)"
    );

    // Thread 6 should be excluded (inbox_visible=false)
    assert!(
        !results
            .iter()
            .any(|r| r.id.to_string() == "20000006-0000-0000-0000-000000000006"),
        "Should exclude thread 6 (inbox_visible=false)"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_single_thread_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let thread_id = Uuid::parse_str("20000001-0000-0000-0000-000000000001")?;
    let filter = Arc::new(Expr::Literal(EmailLiteral::ThreadId(thread_id)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, thread_id);
    assert_eq!(results[0].name.as_deref(), Some("Meeting Tomorrow"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_thread_id_with_sender_filter(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Thread 1 is from john, thread 3 is from bob.
    // AND(OR(thread1, thread3), sender=john) should only return thread 1.
    let id1 = Uuid::parse_str("20000001-0000-0000-0000-000000000001")?;
    let id3 = Uuid::parse_str("20000003-0000-0000-0000-000000000003")?;
    let filter = Arc::new(Expr::and(
        Expr::or(
            Expr::Literal(EmailLiteral::ThreadId(id1)),
            Expr::Literal(EmailLiteral::ThreadId(id3)),
        ),
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, id1);
    assert_eq!(results[0].sender_email.as_deref(), Some("john@example.com"));

    Ok(())
}

// Thread 8 is a draft with CATEGORY_UPDATES (depriority label).
// DRAFT is a priority label, so it should appear in importance=true results
// even though it has a depriority label.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_importance_true_includes_drafts_with_depriority_label(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(true)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Thread 8 has DRAFT + CATEGORY_UPDATES. DRAFT is a priority label,
    // so it should be included despite the depriority label.
    assert!(
        result_ids.contains("20000008-0000-0000-0000-000000000008"),
        "importance=true should include draft thread 8 even though it has CATEGORY_UPDATES"
    );

    // Thread 3 is a plain draft (no depriority label) — should also be included
    assert!(
        result_ids.contains("20000003-0000-0000-0000-000000000003"),
        "importance=true should include draft thread 3"
    );

    Ok(())
}

// Thread 9 is a draft with the TRASH label.
// Even though is_draft=true would normally make it important, the TRASH label should exclude it.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_importance_true_excludes_trashed_drafts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(true)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Thread 9 is a draft with TRASH label — should be excluded even though is_draft=true
    assert!(
        !result_ids.contains("20000009-0000-0000-0000-000000000009"),
        "importance=true should exclude trashed draft thread 9"
    );

    // Thread 3 is a normal draft (no TRASH) — should still be included
    assert!(
        result_ids.contains("20000003-0000-0000-0000-000000000003"),
        "importance=true should still include non-trashed draft thread 3"
    );

    // Thread 8 is a draft with CATEGORY_UPDATES but no TRASH — should still be included
    assert!(
        result_ids.contains("20000008-0000-0000-0000-000000000008"),
        "importance=true should still include non-trashed draft thread 8"
    );

    Ok(())
}

// Thread 8 is a draft with CATEGORY_UPDATES (depriority label).
// DRAFT is a priority label, so it should NOT appear in importance=false results.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_importance_false_excludes_drafts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(false)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query).await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Thread 8 has CATEGORY_UPDATES (depriority) but also DRAFT (priority).
    // Since DRAFT is a priority label, it should be excluded from importance=false.
    assert!(
        !result_ids.contains("20000008-0000-0000-0000-000000000008"),
        "importance=false should exclude draft thread 8 despite having CATEGORY_UPDATES"
    );

    // Thread 3 is a plain draft — should also be excluded (DRAFT is a priority label)
    assert!(
        !result_ids.contains("20000003-0000-0000-0000-000000000003"),
        "importance=false should exclude draft thread 3"
    );

    // Only non-draft threads with depriority labels should appear
    assert!(
        result_ids.contains("20000006-0000-0000-0000-000000000006"),
        "Should include thread 6 (CATEGORY_UPDATES, not a draft)"
    );
    assert!(
        result_ids.contains("20000007-0000-0000-0000-000000000007"),
        "Should include thread 7 (CATEGORY_PROMOTIONS, not a draft)"
    );
    assert_eq!(
        results.len(),
        2,
        "Only non-draft depriority threads should appear"
    );

    Ok(())
}

// ── Static view TRASH exclusion tests ───────────────────────────────

// Static important query should exclude trashed drafts (thread 9) and trashed important messages.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_static_important_excludes_trashed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let limit = 50;
    let query = Query::Sort(SimpleSortMethod::UpdatedAt, ());

    let results =
        preview_views::important::important_preview_cursor(&pool, &link_id, limit, &query).await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        !result_ids.contains("20000009-0000-0000-0000-000000000009"),
        "Static important query should exclude trashed draft thread 9"
    );

    // Non-trashed drafts should still be included
    assert!(
        result_ids.contains("20000003-0000-0000-0000-000000000003"),
        "Should still include non-trashed draft thread 3"
    );
    assert!(
        result_ids.contains("20000005-0000-0000-0000-000000000005"),
        "Should still include important thread 5"
    );

    Ok(())
}

// Static starred query should exclude trashed starred messages (thread 10).
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_static_starred_excludes_trashed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let limit = 50;
    let query = Query::Sort(SimpleSortMethod::UpdatedAt, ());

    let results =
        preview_views::starred::starred_preview_cursor(&pool, &link_id, limit, &query).await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        !result_ids.contains("20000010-0000-0000-0000-000000000010"),
        "Starred view should exclude trashed starred thread 10"
    );

    // Non-trashed starred should still be included
    assert!(
        result_ids.contains("20000004-0000-0000-0000-000000000004"),
        "Should still include non-trashed starred thread 4"
    );

    Ok(())
}

// Static drafts query should exclude trashed drafts (thread 9).
// Note: drafts view only shows macro drafts (internal_date_ts IS NULL),
// so thread 9 (which has internal_date_ts set) won't appear regardless.
// Thread 3 and 8 have internal_date_ts set too, so the drafts view fixture
// data doesn't have macro-style drafts with TRASH. This test verifies the
// query doesn't break and still returns expected results.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_static_drafts_excludes_trashed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let limit = 50;
    let query = Query::Sort(SimpleSortMethod::UpdatedAt, ());

    let results =
        preview_views::draft::drafts_preview_cursor(&pool, &link_id, limit, &query).await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Thread 9 is a trashed draft — should be excluded
    assert!(
        !result_ids.contains("20000009-0000-0000-0000-000000000009"),
        "Drafts view should exclude trashed draft thread 9"
    );

    Ok(())
}

// Static user label query should exclude trashed messages with that label (thread 11).
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_static_user_label_excludes_trashed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let limit = 50;
    let query = Query::Sort(SimpleSortMethod::UpdatedAt, ());

    let results = preview_views::user_label::user_label_preview_cursor(
        &pool, &link_id, limit, &query, "Work",
    )
    .await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        !result_ids.contains("20000011-0000-0000-0000-000000000011"),
        "User label view should exclude trashed thread 11"
    );

    // Non-trashed "Work" label should still be included
    assert!(
        result_ids.contains("20000006-0000-0000-0000-000000000006"),
        "Should still include non-trashed Work thread 6"
    );

    Ok(())
}
