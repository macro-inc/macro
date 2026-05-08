use super::*;
use macro_user_id::cowlike::CowLike;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query2, "").await?;

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
            dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
            dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_email_filters")
    )
)]
async fn test_dynamic_query_importance_true_email_filters_domain_with_address_override(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(true)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        result_ids.contains("20000012-0000-0000-0000-000000000012"),
        "Should include thread 12 via sender domain important rule"
    );
    assert!(
        !result_ids.contains("20000013-0000-0000-0000-000000000013"),
        "Should exclude thread 13 because sender address override beats important domain rule"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_email_filters")
    )
)]
async fn test_dynamic_query_importance_true_email_filters_excludes_trashed_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(true)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        !result_ids.contains("20000016-0000-0000-0000-000000000016"),
        "Should exclude thread 16 because the sender is important but the only matching message is trashed"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_email_filters")
    )
)]
async fn test_dynamic_query_importance_false_email_filters_domain_with_address_override(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Importance(false)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        result_ids.contains("20000014-0000-0000-0000-000000000014"),
        "Should include thread 14 via sender domain not-important rule"
    );
    assert!(
        !result_ids.contains("20000015-0000-0000-0000-000000000015"),
        "Should exclude thread 15 because sender address important override beats not-important domain rule"
    );

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

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

// === Shared email thread tests ===

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads")
    )
)]
async fn test_shared_exclude_returns_only_own_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Exclude,
    )));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        &pool,
        &link_id,
        limit,
        &view,
        query,
        "macro|user1@test.com",
    )
    .await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Should NOT include any of user2's threads
    assert!(
        !result_ids.contains("20000101-0000-0000-0000-000000000101"),
        "Exclude mode should not return directly shared thread"
    );
    assert!(
        !result_ids.contains("20000102-0000-0000-0000-000000000102"),
        "Exclude mode should not return project-shared thread"
    );
    assert!(
        !result_ids.contains("20000103-0000-0000-0000-000000000103"),
        "Exclude mode should not return unshared thread from other user"
    );

    // Should include user1's own threads
    assert!(
        !results.is_empty(),
        "Exclude mode should still return user's own threads"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads")
    )
)]
async fn test_shared_only_returns_only_shared_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Only,
    )));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        &pool,
        &link_id,
        limit,
        &view,
        query,
        "macro|user1@test.com",
    )
    .await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Should include directly shared thread
    assert!(
        result_ids.contains("20000101-0000-0000-0000-000000000101"),
        "Only mode should return directly shared thread 101"
    );

    // Should include project-shared thread
    assert!(
        result_ids.contains("20000102-0000-0000-0000-000000000102"),
        "Only mode should return project-shared thread 102"
    );

    // Should NOT include unshared thread from user2
    assert!(
        !result_ids.contains("20000103-0000-0000-0000-000000000103"),
        "Only mode should not return unshared thread 103"
    );

    // Should NOT include any of user1's own threads
    assert!(
        !result_ids.contains("20000001-0000-0000-0000-000000000001"),
        "Only mode should not return user's own threads"
    );

    assert_eq!(
        results.len(),
        2,
        "Only mode should return exactly 2 shared threads"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads")
    )
)]
async fn test_shared_include_returns_own_and_shared_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Include,
    )));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        &pool,
        &link_id,
        limit,
        &view,
        query,
        "macro|user1@test.com",
    )
    .await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Should include user1's own threads
    assert!(
        result_ids.contains("20000001-0000-0000-0000-000000000001"),
        "Include mode should return user's own thread 1"
    );

    // Should include directly shared thread
    assert!(
        result_ids.contains("20000101-0000-0000-0000-000000000101"),
        "Include mode should return directly shared thread 101"
    );

    // Should include project-shared thread
    assert!(
        result_ids.contains("20000102-0000-0000-0000-000000000102"),
        "Include mode should return project-shared thread 102"
    );

    // Should NOT include unshared thread from user2
    assert!(
        !result_ids.contains("20000103-0000-0000-0000-000000000103"),
        "Include mode should not return unshared thread 103"
    );

    Ok(())
}

// ── calendar_only filter tests ──────────────────────────────────────
//
// The email_dynamic_query_calendar fixture attaches iCalendar and non-iCalendar
// attachments to threads 1, 2, 4, 5, 7. Threads 1/2/4/5 should match the
// calendar_only=true predicate; thread 7 and all unattached threads should not.

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_calendar")
    )
)]
async fn test_dynamic_query_calendar_only_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::CalendarOnly(true)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        result_ids.contains("20000001-0000-0000-0000-000000000001"),
        "Thread 1 (.ics filename) should match"
    );
    assert!(
        result_ids.contains("20000002-0000-0000-0000-000000000002"),
        "Thread 2 (.ics filename) should match"
    );
    assert!(
        result_ids.contains("20000004-0000-0000-0000-000000000004"),
        "Thread 4 (application/ics mime) should match"
    );
    assert!(
        result_ids.contains("20000005-0000-0000-0000-000000000005"),
        "Thread 5 (one of two attachments is .ics) should match"
    );

    assert!(
        !result_ids.contains("20000003-0000-0000-0000-000000000003"),
        "Thread 3 (no attachments) should not match"
    );
    assert!(
        !result_ids.contains("20000006-0000-0000-0000-000000000006"),
        "Thread 6 (no attachments) should not match"
    );
    assert!(
        !result_ids.contains("20000007-0000-0000-0000-000000000007"),
        "Thread 7 (only a non-calendar pdf attachment) should not match"
    );
    assert!(
        !result_ids.contains("20000008-0000-0000-0000-000000000008"),
        "Thread 8 (no attachments) should not match"
    );

    assert_eq!(
        results.len(),
        4,
        "Expected exactly 4 matching threads (1, 2, 4, 5), got: {:?}",
        result_ids
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_calendar")
    )
)]
async fn test_dynamic_query_calendar_only_inbox_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;

    let filter = Arc::new(Expr::Literal(EmailLiteral::CalendarOnly(true)));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    // Inbox view restricts to inbox_visible=true AND latest_inbound_message_ts IS NOT NULL.
    // Of the calendar-matching threads (1, 2, 4, 5), only 1, 4, 5 are inbox-visible with an
    // inbound ts. Thread 2 is sent (inbox_visible=false).
    assert!(result_ids.contains("20000001-0000-0000-0000-000000000001"));
    assert!(result_ids.contains("20000004-0000-0000-0000-000000000004"));
    assert!(result_ids.contains("20000005-0000-0000-0000-000000000005"));
    assert!(
        !result_ids.contains("20000002-0000-0000-0000-000000000002"),
        "Thread 2 is sent, not inbox-visible"
    );
    assert!(
        !result_ids.contains("20000007-0000-0000-0000-000000000007"),
        "Thread 7 is inbox but has no .ics attachment"
    );
    assert_eq!(results.len(), 3);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_calendar")
    )
)]
async fn test_dynamic_query_calendar_only_combined_with_sender(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // calendar_only=true AND sender=john@example.com → {1, 2, 5}. Threads 1, 2, 5 are all
    // from john with an .ics attachment; thread 4 has .ics but is from alice.
    let filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::CalendarOnly(true)),
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(result_ids.contains("20000001-0000-0000-0000-000000000001"));
    assert!(result_ids.contains("20000002-0000-0000-0000-000000000002"));
    assert!(result_ids.contains("20000005-0000-0000-0000-000000000005"));
    assert!(
        !result_ids.contains("20000004-0000-0000-0000-000000000004"),
        "Thread 4 has .ics but is from alice, not john"
    );
    assert_eq!(results.len(), 3);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_calendar")
    )
)]
async fn test_dynamic_query_calendar_only_false_is_noop(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 50;

    // calendar_only=false combined with a broad sender filter so the dynamic path is taken.
    // Result set should match the sender filter alone with no additional calendar restriction.
    let with_false = {
        let filter = Arc::new(Expr::and(
            Expr::Literal(EmailLiteral::CalendarOnly(false)),
            Expr::Literal(EmailLiteral::Sender(Email::Partial(
                "example.com".to_string(),
            ))),
        ));
        let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?
    };
    let baseline = {
        let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
            "example.com".to_string(),
        ))));
        let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?
    };

    let with_false_ids: std::collections::HashSet<_> = with_false.iter().map(|r| r.id).collect();
    let baseline_ids: std::collections::HashSet<_> = baseline.iter().map(|r| r.id).collect();
    assert_eq!(with_false_ids, baseline_ids);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads")
    )
)]
async fn test_shared_only_returns_correct_owner_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Only,
    )));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        &pool,
        &link_id,
        limit,
        &view,
        query,
        "macro|user1@test.com",
    )
    .await?;

    // All shared threads should have user2's macro_id as owner
    for result in &results {
        assert_eq!(
            result.owner_id.as_str(),
            "macro|user2@test.com",
            "Shared threads should have user2 as owner, got {:?} for thread {}",
            result.owner_id,
            result.id
        );
    }

    Ok(())
}

// Filtering by a Complete email that has no contact in `email_contacts`
// for this link must short-circuit to an empty result set without
// running the main query. This is what `resolve_filters` +
// `can_short_circuit` are for: the AST `Sender(Complete(missing))`
// folds to FALSE and the entry point returns `Vec::new()`.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_short_circuits_on_unresolved_complete_email(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // No contact with this email exists in the fixture.
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Complete(
        EmailStr::parse_from_str("nobody@nowhere.com")?.into_owned(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    assert!(
        results.is_empty(),
        "filtering by an unresolved Complete email must short-circuit to no results, got {} threads",
        results.len()
    );

    Ok(())
}

// Filtering by `Bcc(bob)` must return thread 4: the edge-cases fixture
// adds bob as a BCC recipient on message 4. Exercises the BCC arm of
// `build_address_predicate_on_m` and the Bcc UNION branch in
// `build_matching_threads_cte_body`. Without this test, no SQL-level
// path covers BCC.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_address_edge_cases")
    )
)]
async fn test_dynamic_query_with_bcc_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    let email_filter = Arc::new(Expr::Literal(EmailLiteral::Bcc(Email::Complete(
        EmailStr::parse_from_str("bob@example.com")?.into_owned(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, email_filter);

    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;

    let result_ids: std::collections::HashSet<String> =
        results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        result_ids.contains("20000004-0000-0000-0000-000000000004"),
        "Bcc(bob) should match thread 4 (bob is BCC on message 4); got {:?}",
        result_ids
    );
    // Thread 7 has bob as CC, not BCC — it must NOT match a Bcc filter.
    assert!(
        !result_ids.contains("20000007-0000-0000-0000-000000000007"),
        "Bcc(bob) must not match thread 7 (bob is CC there, not BCC); got {:?}",
        result_ids
    );

    Ok(())
}

// `Sender(john) AND Recipient(alice)` must match using *single-message*
// semantics: the thread is included iff some single message satisfies
// both conjuncts. Thread 12 (split between msg12a john→bob and msg12b
// bob→alice) has john-as-sender on one message AND alice-as-recipient on
// a *different* message — neither message individually satisfies both,
// so the thread must be excluded. The same filter must still match
// thread 1 (msg1: john→alice) where a single message does satisfy both.
//
// Sanity check: filtering by `Sender(john)` alone must include thread 12,
// proving the fixture is wired correctly and the exclusion above is
// driven by single-message semantics rather than a missing fixture row.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_address_edge_cases")
    )
)]
async fn test_dynamic_query_and_filter_uses_single_message_semantics(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let limit = 50;

    // Sanity: Sender(john) alone matches the split thread (msg12a is from
    // john) — so the fixture is wired up and john has at least one
    // message on thread 12.
    {
        let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))));
        let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);
        let results =
            dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;
        let ids: std::collections::HashSet<String> =
            results.iter().map(|r| r.id.to_string()).collect();
        assert!(
            ids.contains("20000012-0000-0000-0000-000000000012"),
            "fixture sanity: Sender(john) should include thread 12 (msg12a is from john); got {:?}",
            ids
        );
    }

    // The actual assertion: AND-of-conjuncts is single-message-scoped.
    let filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
        Expr::Literal(EmailLiteral::Recipient(Email::Complete(
            EmailStr::parse_from_str("alice@example.com")?.into_owned(),
        ))),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);
    let results =
        dynamic::dynamic_email_thread_cursor(&pool, &link_id, limit, &view, query, "").await?;
    let ids: std::collections::HashSet<String> = results.iter().map(|r| r.id.to_string()).collect();

    assert!(
        !ids.contains("20000012-0000-0000-0000-000000000012"),
        "Sender(john) AND Recipient(alice) must NOT match thread 12: john's message and \
         alice's message are different messages on that thread, so no single message satisfies \
         both conjuncts. got: {:?}",
        ids
    );

    // And it should still match thread 1, where msg1 is john → alice on
    // a single message (the positive case, already covered by
    // `test_dynamic_query_with_and_filter` but re-asserted here so a
    // regression that drops thread 1 wouldn't be hidden by the negative
    // assertion above succeeding for the wrong reason).
    assert!(
        ids.contains("20000001-0000-0000-0000-000000000001"),
        "Sender(john) AND Recipient(alice) should still match thread 1 (msg1: john → alice); \
         got: {:?}",
        ids
    );

    Ok(())
}
