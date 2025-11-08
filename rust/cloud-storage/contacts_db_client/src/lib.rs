use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres, Transaction};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRowId {
    id: i32,
}

pub async fn create_connections(
    transaction: &mut Transaction<'_, Postgres>,
    connections: Vec<(String, String)>,
) -> Result<(), sqlx::Error> {
    let mut query = "INSERT INTO connections(user1, user2) VALUES ".to_string();
    let mut values: Vec<String> = Vec::new();
    let mut parameters: Vec<String> = Vec::new();

    for connection in connections {
        let param_number = parameters.len() + 1;
        values.push(format!("(${}, ${})", param_number, param_number + 1));

        if connection.0 < connection.1 {
            parameters.push(connection.0);
            parameters.push(connection.1);
        } else {
            parameters.push(connection.1);
            parameters.push(connection.0);
        }
    }
    query += &values.join(", ");
    query += " ON CONFLICT(user1, user2) DO UPDATE SET updated_at = now();";

    let mut query = sqlx::query(&query);

    for param in parameters {
        query = query.bind(param);
    }

    query.execute(transaction.as_mut()).await?;

    Ok(())
}

/// Retreives a connection from a row id
#[cfg(test)]
async fn get_connection(db: &Pool<Postgres>, id: i32) -> Result<(String, String)> {
    let result = sqlx::query!("SELECT user1, user2 FROM connections WHERE id = $1", id)
        .fetch_one(db)
        .await?;

    let user1 = result.user1.to_string();
    let user2 = result.user2.to_string();

    Ok((user1, user2))
}

/// Gets a contact list from a user
pub async fn get_contacts(db: &Pool<Postgres>, user: &str) -> Result<Vec<String>> {
    let result = sqlx::query!(
        "
        SELECT user1 AS contact FROM connections WHERE user2 = $1
        UNION
        SELECT user2 AS contact from connections WHERE user1 = $1
    ",
        &user
    )
    .fetch_all(db)
    .await?;

    let users: Vec<String> = result
        .iter()
        .map(|row| row.contact.as_ref().unwrap().to_string())
        .collect();

    Ok(users)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;
    use std::collections::HashSet;

    #[sqlx::test]
    async fn test_storage_basic(pool: PgPool) -> sqlx::Result<()> {
        let user1 = "05E6766A-7972-4116-8BAD-2038E57D5ADF";
        let user2 = "CD7230E3-7718-4692-9C32-7C76BD70C076";
        let connections: Vec<(String, String)> = [(user1.to_string(), user2.to_string())].to_vec();
        //.into_iter()
        //.map(|x| (x.0.to_string(), x.1.to_string()))
        //.collect();

        let mut transaction = pool.begin().await?;
        create_connections(&mut transaction, connections).await?;
        transaction.commit().await?;

        let pair = sqlx::query!("SELECT user1, user2 FROM connections LIMIT 1")
            .fetch_one(&pool)
            .await?;

        assert_eq!(&user1, &pair.user1);
        assert_eq!(&user2, &pair.user2);

        Ok(())
    }

    #[sqlx::test]
    async fn test_storage_ordering(pool: PgPool) -> sqlx::Result<()> {
        let user1 = "05E6766A-7972-4116-8BAD-2038E57D5ADF".to_string();
        let user2 = "CD7230E3-7718-4692-9C32-7C76BD70C076".to_string();

        let connections: Vec<(String, String)> = [(user2.to_string(), user1.to_string())].to_vec();

        // Insert in opposite order
        let mut transaction = pool.begin().await?;
        create_connections(&mut transaction, connections).await?;
        transaction.commit().await?;

        let pair = sqlx::query!("SELECT user1, user2 FROM connections LIMIT 1")
            .fetch_one(&pool)
            .await?;

        // Correction
        assert_eq!(&user1, &pair.user1);
        assert_eq!(&user2, &pair.user2);
        Ok(())
    }

    #[sqlx::test(fixtures("user_list"))]
    async fn test_get_contacts(pool: PgPool) -> sqlx::Result<()> {
        let user = "51028BDA-67F0-44DF-AA21-5853963524F1".to_string();

        let contacts = get_contacts(&pool, &user).await;

        if let Err(e) = &contacts {
            dbg!("error: {:?}", e);
        }

        assert!(contacts.is_ok());

        let contacts = contacts.unwrap();

        dbg!(&contacts);
        assert_eq!(contacts.len(), 3);

        Ok(())
    }

    #[sqlx::test]
    async fn test_create_connections(pool: PgPool) -> sqlx::Result<()> {
        let connections: Vec<(String, String)> = [
            (
                "C3B1970F-18EE-4DFA-B5FB-E8240E28E51D",
                "AE2C090C-E478-4454-A001-3DF458BF1FE4",
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
        .map(|s| (s.0.to_string(), s.1.to_string()))
        .collect();

        let mut transaction = pool.begin().await?;
        create_connections(&mut transaction, connections).await?;
        transaction.commit().await?;

        let result = sqlx::query!("SELECT count(*) as count FROM connections; ")
            .fetch_one(&pool)
            .await?;

        let count = result.count.unwrap();
        assert_eq!(count, 8);

        let contacts = get_contacts(&pool, "AE2C090C-E478-4454-A001-3DF458BF1FE4").await;
        assert!(contacts.is_ok());
        let contacts = contacts.unwrap();
        assert_eq!(contacts.len(), 7);

        let expectations: HashSet<String> = [
            "FF038D36-1AEF-461A-8AA8-34001FA1ABAD",
            "C3F4D826-F8FD-478A-AA66-B5B6BB370CBC",
            "D44CAADA-98C0-49EB-AB20-6851B824983A",
            "5AB8C770-F2CB-4C6C-BC08-AE64569E324C",
            "79A5557B-7827-4E2E-A6AE-F0935CDB762E",
            "C3B1970F-18EE-4DFA-B5FB-E8240E28E51D",
            "9EFFE035-BB12-4FCC-B479-800E1C2551A8",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let reality: HashSet<String> = contacts.into_iter().collect();

        assert_eq!(&expectations, &reality);
        Ok(())
    }
}
