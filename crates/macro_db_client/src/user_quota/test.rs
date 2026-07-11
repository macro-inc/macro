use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../fixtures", scripts("user_quota")))]
async fn test_get_user_quota(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")?.lowercase();

    let quota = get_user_quota(&pool, &user_id).await?;

    assert_eq!(quota.documents, 4);
    assert_eq!(quota.ai_chat_messages, 6);

    let user_id = MacroUserId::parse_from_str("macro|user2@user.com")?.lowercase();
    let quota = get_user_quota(&pool, &user_id).await?;

    assert_eq!(quota.documents, 1);
    assert_eq!(quota.ai_chat_messages, 0);

    Ok(())
}
