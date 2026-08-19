use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;

const USER_A: &str = "macro|categories-a@example.com";
const USER_B: &str = "macro|categories-b@example.com";

async fn seed_user(pool: &PgPool, user_id: &str) {
    let macro_user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)",
    )
    .bind(macro_user_id)
    .bind(user_id)
    .bind(user_id.trim_start_matches("macro|"))
    .bind(format!("stripe-{macro_user_id}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#)
        .bind(user_id)
        .bind(user_id.trim_start_matches("macro|"))
        .bind(macro_user_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn seed_channel(pool: &PgPool, owner_id: &str, participants: &[&str]) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'channel', 'public', $2)",
    )
    .bind(id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    for user_id in participants {
        sqlx::query(
            "INSERT INTO comms_channel_participants (channel_id, role, user_id) VALUES ($1, 'member', $2)",
        )
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
    }
    id
}

async fn seed_direct_message(pool: &PgPool, owner_id: &str, participants: &[&str]) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, NULL, 'direct_message', $2)",
    )
        .bind(id)
        .bind(owner_id)
        .execute(pool)
        .await
        .unwrap();
    for user_id in participants {
        sqlx::query(
            "INSERT INTO comms_channel_participants (channel_id, role, user_id) VALUES ($1, 'member', $2)",
        )
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
    }
    id
}

fn user(value: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_owned()).unwrap()
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn write_read_visibility_user_scope_and_uncategorized_order(pool: PgPool) {
    seed_user(&pool, USER_A).await;
    seed_user(&pool, USER_B).await;
    let first = seed_channel(&pool, USER_A, &[USER_A]).await;
    let second = seed_channel(&pool, USER_A, &[USER_A]).await;
    let other_user_only = seed_channel(&pool, USER_B, &[USER_B]).await;
    let category_id = Uuid::new_v4();
    let repo = PgChannelCategoryRepo::new(pool.clone());

    let saved = match repo
        .replace_layout(
            user(USER_A),
            ChannelCategoryLayout {
                revision: 0,
                categories: vec![ChannelCategory {
                    id: category_id,
                    name: "Work".into(),
                }],
                placements: vec![
                    ChannelPlacement {
                        channel_id: second,
                        category_id: None,
                    },
                    ChannelPlacement {
                        channel_id: first,
                        category_id: Some(category_id),
                    },
                ],
            },
        )
        .await
        .unwrap()
    {
        ReplaceLayoutOutcome::Replaced(layout) => layout,
        _ => panic!("visible layout should be accepted"),
    };
    assert_eq!(saved.revision, 1);
    assert_eq!(repo.get_layout(user(USER_A)).await.unwrap(), saved);
    assert_eq!(
        repo.get_layout(user(USER_B)).await.unwrap(),
        ChannelCategoryLayout::default()
    );

    let unavailable = repo
        .replace_layout(
            user(USER_A),
            ChannelCategoryLayout {
                revision: 1,
                categories: vec![],
                placements: vec![ChannelPlacement {
                    channel_id: other_user_only,
                    category_id: None,
                }],
            },
        )
        .await
        .unwrap();
    assert!(matches!(unavailable, ReplaceLayoutOutcome::Unavailable));
    assert_eq!(repo.get_layout(user(USER_A)).await.unwrap(), saved);

    sqlx::query(
        "UPDATE comms_channel_participants SET left_at = now() WHERE user_id = $1 AND channel_id = $2",
    )
    .bind(USER_A)
    .bind(first)
    .execute(&pool)
    .await
    .unwrap();
    let visible = repo.get_layout(user(USER_A)).await.unwrap();
    assert_eq!(visible.revision, 1);
    assert_eq!(visible.categories, saved.categories);
    assert_eq!(
        visible.placements,
        vec![ChannelPlacement {
            channel_id: second,
            category_id: None
        }]
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn stale_and_concurrent_writes_have_one_winner(pool: PgPool) {
    seed_user(&pool, USER_A).await;
    let repo = PgChannelCategoryRepo::new(pool);
    let first = repo.replace_layout(user(USER_A), ChannelCategoryLayout::default());
    let second = repo.replace_layout(user(USER_A), ChannelCategoryLayout::default());
    let (first, second) = tokio::join!(first, second);
    let outcomes = [first.unwrap(), second.unwrap()];
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| matches!(outcome, ReplaceLayoutOutcome::Replaced(_)))
            .count(),
        1
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| matches!(outcome, ReplaceLayoutOutcome::Conflict))
            .count(),
        1
    );
    assert_eq!(repo.get_layout(user(USER_A)).await.unwrap().revision, 1);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn direct_message_is_rejected_on_write_and_excluded_on_read(pool: PgPool) {
    seed_user(&pool, USER_A).await;
    let direct_message = seed_direct_message(&pool, USER_A, &[USER_A]).await;
    let repo = PgChannelCategoryRepo::new(pool.clone());

    let outcome = repo
        .replace_layout(
            user(USER_A),
            ChannelCategoryLayout {
                revision: 0,
                categories: vec![],
                placements: vec![ChannelPlacement {
                    channel_id: direct_message,
                    category_id: None,
                }],
            },
        )
        .await
        .unwrap();
    assert!(matches!(outcome, ReplaceLayoutOutcome::Unavailable));

    // Prove the read-side visibility intersection independently of the write
    // guard by simulating a stale/corrupt historical placement.
    sqlx::query(
        "INSERT INTO user_channel_placement (user_id, channel_id, category_id, sort_order) VALUES ($1, $2, NULL, 0)",
    )
    .bind(USER_A)
    .bind(direct_message)
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.get_layout(user(USER_A))
            .await
            .unwrap()
            .placements
            .is_empty()
    );
}
