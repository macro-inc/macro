use super::*;
use crate::history::upsert_user_history_timestamp;
use macro_user_id::user_id::MacroUserIdStr;

// The fixture seeds document-one's history row with createdAt = updatedAt —
// the same shape server-side document creation writes.
#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_history")))]
async fn seeded_row_reads_unopened(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let opened =
        user_history_item_opened(&pool, "macro|user@user.com", "document-one", "document").await?;

    assert_eq!(opened, Some(false));
    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_history")))]
async fn history_upsert_flips_to_opened(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // The open path (POST /history) upserts, bumping updatedAt past the
    // seeded createdAt.
    let mut transaction = pool.begin().await?;
    upsert_user_history_timestamp(
        &mut transaction,
        MacroUserIdStr::parse_from_str("macro|user@user.com")?,
        "document-one",
        "document",
        &chrono::Utc::now(),
    )
    .await?;
    transaction.commit().await?;

    let opened =
        user_history_item_opened(&pool, "macro|user@user.com", "document-one", "document").await?;

    assert_eq!(opened, Some(true));
    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_history")))]
async fn missing_row_is_none(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let opened =
        user_history_item_opened(&pool, "macro|user@user.com", "no-such-item", "document").await?;

    assert_eq!(opened, None);
    Ok(())
}
