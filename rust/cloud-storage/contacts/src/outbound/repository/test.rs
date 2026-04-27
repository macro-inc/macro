use crate::domain::ports::ContactsRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::DbContactsRepository;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_create_connections_basic(pool: PgPool) -> sqlx::Result<()> {
    let user1 = "05E6766A-7972-4116-8BAD-2038E57D5ADF";
    let user2 = "CD7230E3-7718-4692-9C32-7C76BD70C076";
    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(vec![(user1.to_string(), user2.to_string())])
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
    let user1 = "05E6766A-7972-4116-8BAD-2038E57D5ADF";
    let user2 = "CD7230E3-7718-4692-9C32-7C76BD70C076";
    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(vec![(user2.to_string(), user1.to_string())])
        .await
        .unwrap();
    let pair = sqlx::query!("SELECT user1, user2 FROM contacts_connections LIMIT 1")
        .fetch_one(&pool)
        .await?;
    assert_eq!(pair.user1, user1);
    assert_eq!(pair.user2, user2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures(path = "fixtures", scripts("user_list")))]
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
    let connections: Vec<(String, String)> = [
        (
            "AE2C090C-E478-4454-A001-3DF458BF1FE4",
            "C3B1970F-18EE-4DFA-B5FB-E8240E28E51D",
        ),
        (
            "AE2C090C-E478-4454-A001-3DF458BF1FE4",
            "79A5557B-7827-4E2E-A6AE-F0935CDB762E",
        ),
        (
            "AE2C090C-E478-4454-A001-3DF458BF1FE4",
            "D44CAADA-98C0-49EB-AB20-6851B824983A",
        ),
        (
            "AE2C090C-E478-4454-A001-3DF458BF1FE4",
            "5AB8C770-F2CB-4C6C-BC08-AE64569E324C",
        ),
        (
            "AE2C090C-E478-4454-A001-3DF458BF1FE4",
            "C3F4D826-F8FD-478A-AA66-B5B6BB370CBC",
        ),
        (
            "AE2C090C-E478-4454-A001-3DF458BF1FE4",
            "FF038D36-1AEF-461A-8AA8-34001FA1ABAD",
        ),
        (
            "AE2C090C-E478-4454-A001-3DF458BF1FE4",
            "9EFFE035-BB12-4FCC-B479-800E1C2551A8",
        ),
        (
            "FF038D36-1AEF-461A-8AA8-34001FA1ABAD",
            "9EFFE035-BB12-4FCC-B479-800E1C2551A8",
        ),
    ]
    .into_iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect();

    let repo = DbContactsRepository::new(pool.clone());
    repo.create_connections(connections).await.unwrap();

    let count = sqlx::query_scalar!("SELECT count(*) FROM contacts_connections")
        .fetch_one(&pool)
        .await?
        .unwrap();
    assert_eq!(count, 8);

    let contacts = repo
        .get_contacts("AE2C090C-E478-4454-A001-3DF458BF1FE4")
        .await
        .unwrap();
    assert_eq!(contacts.len(), 7);
    Ok(())
}
