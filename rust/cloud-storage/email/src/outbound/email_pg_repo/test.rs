use super::*;
use crate::domain::models::{
    LabelType, PreviewCursorQuery, PreviewView, PreviewViewStandardLabel,
};
use crate::domain::ports::EmailRepo;
use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::email::EmailStr;
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_single_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("11111111-1111-1111-1111-111111111111")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 2, "Thread 1 should have 2 labels");

    let inbox_label = labels.iter().find(|l| l.name == "INBOX");
    assert!(inbox_label.is_some(), "Should have INBOX label");

    let important_label = labels.iter().find(|l| l.name == "IMPORTANT");
    assert!(important_label.is_some(), "Should have IMPORTANT label");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_multiple_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?,
        Uuid::parse_str("22222222-2222-2222-2222-222222222222")?,
    ];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    // Thread 1 has 2 labels (INBOX, IMPORTANT)
    // Thread 2 has 2 labels (INBOX, SENT)
    // Should get four unique labels as it's distinct across (thread_id, label_id)
    assert_eq!(
        labels.len(),
        4,
        "Should have 4 unique labels across both threads"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_no_duplicate_labels_same_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // Thread 3 has multiple messages with the same label
    let thread_ids = vec![Uuid::parse_str("33333333-3333-3333-3333-333333333333")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(
        labels.len(),
        1,
        "Should have only 1 label despite multiple messages having it"
    );
    assert_eq!(labels[0].name, "INBOX");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_thread_with_no_labels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("44444444-4444-4444-4444-444444444444")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(
        labels.len(),
        0,
        "Thread with no messages/labels should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids: Vec<Uuid> = vec![];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 0, "Empty input should return empty result");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_different_label_types(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("55555555-5555-5555-5555-555555555555")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 2, "Should have both system and user labels");

    let system_label = labels.iter().find(|l| l.name == "INBOX");
    assert!(system_label.is_some());
    assert_eq!(system_label.unwrap().type_, LabelType::System);

    let user_label = labels.iter().find(|l| l.name == "MyCustomLabel");
    assert!(user_label.is_some());
    assert_eq!(user_label.unwrap().type_, LabelType::User);

    Ok(())
}
// ============================================================================
// Dynamic Query Builder Integration Tests
// ============================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_inbox_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get inbox messages (threads 1, 4, 5, 7)
    assert_eq!(
        results.len(),
        4,
        "Inbox view should return 4 threads with inbox_visible=true"
    );

    // Verify thread 1 is in results
    assert!(
        results.iter().any(|r| r.id.to_string() == "20000001-0000-0000-0000-000000000001"),
        "Should include inbox thread 1"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_sent_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Sent),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

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
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_drafts_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get draft messages (thread 3)
    assert_eq!(results.len(), 1, "Drafts view should return 1 thread");
    assert_eq!(
        results[0].id.to_string(),
        "20000003-0000-0000-0000-000000000003"
    );
    assert!(results[0].is_draft, "Message should be marked as draft");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_starred_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Starred),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

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
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_important_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Important),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get important messages (thread 5)
    assert_eq!(results.len(), 1, "Important view should return 1 thread");
    assert_eq!(
        results[0].id.to_string(),
        "20000005-0000-0000-0000-000000000005"
    );
    assert!(
        results[0].is_important,
        "Message should be marked as important"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_user_label_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let query = PreviewCursorQuery {
        view: PreviewView::UserLabel("Work".to_string()),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

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
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_sender_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Filter for emails from john@example.com
    let email_filter = Expr::Literal(EmailLiteral::Sender(Email::Complete(
        EmailStr::parse_from_str("john@example.com")?.into_owned(),
    )));

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

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
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_partial_sender_filter(pool: Pool<Postgres>) -> anyhow::Result<()>
{
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Filter for emails from anyone at example.com
    let email_filter = Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "example.com".to_string(),
    )));

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get all messages since all contacts are from example.com
    assert!(
        results.len() >= 5,
        "Should return multiple threads from example.com domain"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_recipient_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Filter for emails to alice@example.com
    let email_filter = Expr::Literal(EmailLiteral::Recipient(Email::Complete(
        EmailStr::parse_from_str("alice@example.com")?.into_owned(),
    )));

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get messages to alice@example.com (threads 1, 3, 5, 7)
    assert!(
        results.len() >= 3,
        "Should return threads sent to alice@example.com"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_cc_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Filter for emails with bob@example.com in CC
    let email_filter = Expr::Literal(EmailLiteral::Cc(Email::Complete(
        EmailStr::parse_from_str("bob@example.com")?.into_owned(),
    )));

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

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
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_inbox_with_sender_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Combine Inbox view with sender filter
    let email_filter = Expr::Literal(EmailLiteral::Sender(Email::Complete(
        EmailStr::parse_from_str("john@example.com")?.into_owned(),
    )));

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

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
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_drafts_with_recipient_filter(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Combine Drafts view with recipient filter
    let email_filter = Expr::Literal(EmailLiteral::Recipient(Email::Complete(
        EmailStr::parse_from_str("alice@example.com")?.into_owned(),
    )));

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get draft messages to alice@example.com (thread 3)
    assert_eq!(
        results.len(),
        1,
        "Should return 1 draft thread to alice@example.com"
    );
    assert!(results[0].is_draft, "Should be a draft");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_and_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Filter for emails from john@example.com AND to alice@example.com
    let email_filter = Expr::and(
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
        Expr::Literal(EmailLiteral::Recipient(Email::Complete(
            EmailStr::parse_from_str("alice@example.com")?.into_owned(),
        ))),
    );

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get messages from john to alice (threads 1, 5)
    assert!(
        results.len() >= 1,
        "Should return threads from john to alice"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_with_or_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Filter for emails from john@example.com OR jane@example.com
    let email_filter = Expr::or(
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("john@example.com")?.into_owned(),
        ))),
        Expr::Literal(EmailLiteral::Sender(Email::Complete(
            EmailStr::parse_from_str("jane@example.com")?.into_owned(),
        ))),
    );

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        link_id,
        limit: 50,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, Some(email_filter)),
    };

    let results = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    // Should get messages from john or jane
    assert!(
        results.len() >= 3,
        "Should return threads from john or jane"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_dynamic_query"))
)]
async fn test_dynamic_query_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // First page with limit 2
    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_id,
        limit: 2,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };

    let first_page = dynamic::dynamic_email_thread_cursor(&pool, &query).await?;

    assert_eq!(first_page.len(), 2, "Should return 2 results");

    // Get the cursor from the last item
    let last_item = first_page.last().unwrap();
    let cursor_ts = last_item.sort_ts;
    let cursor_id = last_item.id;

    // Second page using cursor
    let cursor = Cursor {
        id: cursor_id,
        limit: 2,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: cursor_ts,
        },
        filter: None,
    };

    let query2 = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_id,
        limit: 2,
        query: Query::new(Some(cursor), SimpleSortMethod::UpdatedAt, None),
    };

    let second_page = dynamic::dynamic_email_thread_cursor(&pool, &query2).await?;

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
