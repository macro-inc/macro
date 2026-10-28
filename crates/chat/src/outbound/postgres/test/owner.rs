use bot_id::BotId;
use models_permissions::share_permission::TeamLinkShareDefault;

use super::*;

const TEST_BOT: &str = "bot|00000000-0000-0000-0000-00000000b07a";
const SPONSOR: &str = "macro|test@example.com";

#[derive(Debug, PartialEq, Eq)]
struct ChatOwnership {
    chat_user_id: String,
    entity_owner: (String, String),
    grants: Vec<(String, String, String)>,
    user_history_rows: i64,
    item_last_accessed_rows: i64,
}

async fn chat_ownership(pool: &Pool<Postgres>, chat_id: &str) -> ChatOwnership {
    let chat_user_id: String = sqlx::query_scalar(r#"SELECT "userId" FROM "Chat" WHERE id = $1"#)
        .bind(chat_id)
        .fetch_one(pool)
        .await
        .unwrap();
    let entity = fetch_entity_row(pool, chat_id).await;
    let grants = sqlx::query_as(
        r#"
        SELECT source_type::text, source_id, access_level::text
        FROM entity_access
        WHERE entity_id = $1
        ORDER BY source_type::text, source_id
        "#,
    )
    .bind(macro_uuid::string_to_uuid(chat_id).unwrap())
    .fetch_all(pool)
    .await
    .unwrap();
    let item_last_accessed_rows: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "ItemLastAccessed" WHERE item_id = $1 AND item_type = 'chat'"#,
    )
    .bind(chat_id)
    .fetch_one(pool)
    .await
    .unwrap();

    ChatOwnership {
        chat_user_id,
        entity_owner: (entity.get("owner_type"), entity.get("owner_id")),
        grants,
        user_history_rows: chat_history_count(pool, chat_id).await,
        item_last_accessed_rows,
    }
}

fn test_bot_ownership() -> ChatOwnership {
    ChatOwnership {
        chat_user_id: TEST_BOT.to_owned(),
        entity_owner: ("bot".to_owned(), TEST_BOT.to_owned()),
        grants: vec![
            ("bot".to_owned(), TEST_BOT.to_owned(), "owner".to_owned()),
            ("user".to_owned(), SPONSOR.to_owned(), "owner".to_owned()),
        ],
        user_history_rows: 0,
        item_last_accessed_rows: 1,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users"))
)]
async fn bot_owned_create_registers_owner_grants_without_user_history(pool: Pool<Postgres>) {
    let repo = test_repo(pool.clone());

    let chat_id = repo
        .create(
            Owner::Bot(BotId::TEST_A),
            CreateChatArgs {
                name: "Bot Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    assert_eq!(chat_ownership(&pool, &chat_id).await, test_bot_ownership());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users"))
)]
async fn bot_owned_copy_copies_messages_and_registers_owner_grants(pool: Pool<Postgres>) {
    let repo = test_repo(pool.clone());
    let (source_id, _) = create_chat_with_message(&repo).await;

    let copied_id = repo
        .copy_chat(
            Owner::Bot(BotId::TEST_A),
            &source_id,
            CopyChatArgs {
                name: "Bot Copy".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let copied_messages: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM "ChatMessage" WHERE "chatId" = $1"#)
            .bind(&copied_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(copied_messages, 1);
    assert_eq!(
        chat_ownership(&pool, &copied_id).await,
        test_bot_ownership()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users"))
)]
async fn bot_owner_team_default_link_share_comes_from_owner_team(pool: Pool<Postgres>) {
    let team_id = uuid::Uuid::from_u128(0x7ea3);
    sqlx::query(
        r#"
        INSERT INTO team (id, name, owner_id, default_link_share)
        VALUES ($1, 'Bot Team', $2, 'PUBLIC')
        "#,
    )
    .bind(team_id)
    .bind(SPONSOR)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO bots (id, kind, team_id, name, handle)
        VALUES ($1, 'owned', $2, 'Chat bot', 'chat-bot-owner')
        "#,
    )
    .bind(BotId::TEST_A.as_uuid())
    .bind(team_id)
    .execute(&pool)
    .await
    .unwrap();
    let repo = test_repo(pool);
    let teamless_user = MacroUserIdStr::parse_from_str("macro|no-team@example.com")
        .unwrap()
        .into_owned();

    assert_eq!(
        repo.get_team_default_link_share(&Owner::Bot(BotId::TEST_A))
            .await
            .unwrap(),
        Some(TeamLinkShareDefault(Some(LinkShare::Public)))
    );
    assert_eq!(
        repo.get_team_default_link_share(&Owner::User(teamless_user))
            .await
            .unwrap(),
        None
    );
}
