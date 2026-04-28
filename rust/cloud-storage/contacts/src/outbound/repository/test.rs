use crate::domain::ports::ContactsRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use super::DbContactsRepository;

fn mid(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_owned()).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_connections_basic(pool: PgPool) -> sqlx::Result<()> {
    let user1 = "macro|a@test.com";
    let user2 = "macro|b@test.com";
    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(vec![(mid(user1), mid(user2))])
        .await
        .unwrap();
    let pair = sqlx::query!("SELECT user1, user2 FROM contacts_connections LIMIT 1")
        .fetch_one(&pool)
        .await?;
    assert_eq!(pair.user1, user1);
    assert_eq!(pair.user2, user2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_connections_ordering(pool: PgPool) -> sqlx::Result<()> {
    let user1 = "macro|a@test.com";
    let user2 = "macro|b@test.com";
    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(vec![(mid(user2), mid(user1))])
        .await
        .unwrap();
    let pair = sqlx::query!("SELECT user1, user2 FROM contacts_connections LIMIT 1")
        .fetch_one(&pool)
        .await?;
    assert_eq!(pair.user1, user1);
    assert_eq!(pair.user2, user2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("user_list"))
)]
async fn test_get_contacts(pool: PgPool) -> sqlx::Result<()> {
    let repo = DbContactsRepository::new(pool);
    let contacts = repo
        .get_contacts("51028BDA-67F0-44DF-AA21-5853963524F1")
        .await
        .unwrap();
    assert_eq!(contacts.len(), 3);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_connections_batch(pool: PgPool) -> sqlx::Result<()> {
    let connections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)> = (0..8)
        .map(|i| {
            (
                mid("macro|user0@test.com"),
                mid(&format!("macro|user{i}@test.com")),
            )
        })
        .filter(|(a, b)| a.as_ref() != b.as_ref())
        .collect();

    let expected_count = connections.len() as i64;

    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(connections).await.unwrap();

    let count = sqlx::query_scalar!("SELECT count(*) FROM contacts_connections")
        .fetch_one(&pool)
        .await?
        .unwrap();
    assert_eq!(count, expected_count);

    let contacts = repo.get_contacts("macro|user0@test.com").await.unwrap();
    assert_eq!(contacts.len(), expected_count as usize);
    Ok(())
}
