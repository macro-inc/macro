use cowlike::CowLike;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgFavoritesRepo;
use crate::domain::ports::FavoritesRepo;

const USER_A: &str = "macro|user-a@macro.com";
const USER_B: &str = "macro|user-b@macro.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(id)
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .expect("user should insert");
}

async fn insert_document(pool: &PgPool, id: &str, name: &str, owner: &str) {
    sqlx::query(r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, $2, $3)"#)
        .bind(id)
        .bind(name)
        .bind(owner)
        .execute(pool)
        .await
        .expect("document should insert");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn add_favorite_appends_and_is_idempotent(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgFavoritesRepo::new(pool);

    let first = repo
        .add_favorite(
            &user(USER_A),
            &EntityType::Document.with_entity_str("doc-1"),
        )
        .await
        .expect("first favorite should insert");
    let second = repo
        .add_favorite(
            &user(USER_A),
            &EntityType::Channel.with_entity_str("chan-1"),
        )
        .await
        .expect("second favorite should insert");
    assert!(second.sort_order > first.sort_order);

    let duplicate = repo
        .add_favorite(
            &user(USER_A),
            &EntityType::Document.with_entity_str("doc-1"),
        )
        .await
        .expect("duplicate favorite should be a no-op");
    // The existing record is returned unchanged (same position).
    assert_eq!(duplicate.sort_order, first.sort_order);
    assert_eq!(
        repo.count_favorites(&user(USER_A))
            .await
            .expect("count should run"),
        2
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn count_favorites_counts_user_collection(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgFavoritesRepo::new(pool);

    assert_eq!(
        repo.count_favorites(&user(USER_A))
            .await
            .expect("count should run"),
        0
    );

    for entity_id in ["doc-1", "doc-2", "doc-3"] {
        repo.add_favorite(
            &user(USER_A),
            &EntityType::Document.with_entity_str(entity_id),
        )
        .await
        .expect("favorite should insert");
    }
    // Re-adding an existing entity is a no-op and must not inflate the count.
    repo.add_favorite(
        &user(USER_A),
        &EntityType::Document.with_entity_str("doc-1"),
    )
    .await
    .expect("duplicate favorite should be a no-op");

    assert_eq!(
        repo.count_favorites(&user(USER_A))
            .await
            .expect("count should run"),
        3
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_favorites_skips_deleted(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_document(&pool, "doc-live", "Launch plan", USER_A).await;
    insert_document(&pool, "doc-gone", "Old doc", USER_A).await;
    sqlx::query(r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = 'doc-gone'"#)
        .execute(&pool)
        .await
        .expect("document should soft delete");

    let repo = PgFavoritesRepo::new(pool);
    for entity_id in ["doc-live", "doc-gone"] {
        repo.add_favorite(
            &user(USER_A),
            &EntityType::Document.with_entity_str(entity_id),
        )
        .await
        .expect("favorite should insert");
    }
    // An entity with no local table (e.g. a foreign id) still lists, unhydrated.
    repo.add_favorite(
        &user(USER_A),
        &EntityType::EmailThread.with_entity_str(&Uuid::now_v7().to_string()),
    )
    .await
    .expect("email favorite should insert");

    let favorites = repo
        .list_favorites(&user(USER_A))
        .await
        .expect("favorites should list");
    assert_eq!(favorites.len(), 2);
    assert_eq!(favorites[0].entity_id, "doc-live");
    assert_eq!(favorites[1].entity_type, EntityType::EmailThread);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_favorites_hydrates_uuid_keyed_entities(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let channel_id = Uuid::now_v7().to_string();
    sqlx::query(
        r#"INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1::uuid, 'Eng', 'public', $2)"#,
    )
    .bind(&channel_id)
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect("channel should insert");

    let repo = PgFavoritesRepo::new(pool);
    repo.add_favorite(
        &user(USER_A),
        &EntityType::Channel.with_entity_str(&channel_id),
    )
    .await
    .expect("channel favorite should insert");
    // A favorite whose entity_id is not a valid uuid must not break the
    // listing (the uuid tables are joined on a casted entity_id); it lists
    // unhydrated.
    repo.add_favorite(
        &user(USER_A),
        &EntityType::Channel.with_entity_str("not-a-uuid"),
    )
    .await
    .expect("non-uuid channel favorite should insert");

    let favorites = repo
        .list_favorites(&user(USER_A))
        .await
        .expect("favorites should list");
    assert_eq!(favorites.len(), 2);
    assert_eq!(favorites[0].entity_id, channel_id);
    assert_eq!(favorites[0].channel_type.as_deref(), Some("public"));
    assert_eq!(favorites[1].entity_id, "not-a-uuid");
    assert_eq!(favorites[1].channel_type, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn remove_favorite_by_entity_scopes_to_user(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    insert_document(&pool, "doc-1", "Doc 1", USER_A).await;
    let repo = PgFavoritesRepo::new(pool);
    let entity = EntityType::Document.with_entity_str("doc-1");

    repo.add_favorite(&user(USER_A), &entity)
        .await
        .expect("user A favorite should insert");
    repo.add_favorite(&user(USER_B), &entity)
        .await
        .expect("user B favorite should insert");

    let removed = repo
        .remove_favorite_by_entity(&user(USER_A), &entity)
        .await
        .expect("user A unfavorite should run");
    assert!(removed);

    // User B's favorite for the same entity is untouched.
    let b_favorites = repo
        .list_favorites(&user(USER_B))
        .await
        .expect("user B favorites should list");
    assert_eq!(b_favorites.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reorder_favorites_sets_manual_order(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    for entity_id in ["a", "b", "c"] {
        insert_document(&pool, entity_id, entity_id, USER_A).await;
    }
    let repo = PgFavoritesRepo::new(pool);

    for entity_id in ["a", "b", "c"] {
        repo.add_favorite(
            &user(USER_A),
            &EntityType::Document.with_entity_str(entity_id),
        )
        .await
        .expect("favorite should insert");
    }

    let reordered =
        ["c", "b", "a"].map(|entity_id| EntityType::Document.with_entity_str(entity_id));
    repo.reorder_favorites(&user(USER_A), &reordered)
        .await
        .expect("reorder should run");

    let favorites = repo
        .list_favorites(&user(USER_A))
        .await
        .expect("favorites should list");
    let listed: Vec<&str> = favorites.iter().map(|f| f.entity_id.as_str()).collect();
    assert_eq!(listed, ["c", "b", "a"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn favorited_entities_returns_user_favorites(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgFavoritesRepo::new(pool);

    let user_entity = EntityType::Document.with_entity_str("doc-user");
    let other_entity = EntityType::Chat.with_entity_str("chat-other");

    repo.add_favorite(&user(USER_A), &user_entity)
        .await
        .expect("user favorite should insert");

    let favorited = repo
        .favorited_entities(
            &user(USER_A),
            &[user_entity.copied(), other_entity.copied()],
        )
        .await
        .expect("favorited lookup should run");

    assert_eq!(favorited.len(), 1);
    assert!(favorited.contains(&user_entity));
    assert!(!favorited.contains(&other_entity));

    // USER_B has not favorited the entity, so it is not returned for them.
    let favorited_b = repo
        .favorited_entities(&user(USER_B), &[user_entity.copied()])
        .await
        .expect("favorited lookup should run");
    assert!(favorited_b.is_empty());
}
