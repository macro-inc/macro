use anyhow::Context;
use redis::AsyncCommands;

use model::document::SaveBomPart;

use super::SHA_COUNT_KEY_PREFIX;

/// Checks if a given key exists
#[tracing::instrument(skip(client))]
pub(crate) async fn exists(
    client: &redis::cluster::ClusterClient,
    key: &str,
) -> anyhow::Result<bool> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    let exists = redis_connection.exists::<&str, u8>(key).await?;

    Ok(exists != 0)
}

#[tracing::instrument(skip(client))]
pub(crate) async fn find_non_existing_shas(
    client: &redis::cluster::ClusterClient,
    bom_parts: &Vec<SaveBomPart>,
) -> anyhow::Result<Vec<SaveBomPart>> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    let mut result: Vec<SaveBomPart> = vec![];

    for bp in bom_parts.iter() {
        let exists = redis_connection
            .exists::<&str, u8>(format!("{}{}", SHA_COUNT_KEY_PREFIX, bp.sha).as_str())
            .await?;

        // If the sha does not exists, add it to the result
        if exists == 0 {
            result.push(bp.clone());
        }
    }

    Ok(result)
}

/// Checks if a list of shas exist in the cache
/// Adds the sha to the result list if it is NOT present in the cache
#[tracing::instrument(skip(client))]
pub(crate) async fn find_non_existing_shas_string(
    client: &redis::cluster::ClusterClient,
    shas: Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let mut redis_connection = client
        .get_async_connection()
        .await
        .context("unable to connect to redis")?;

    let mut results: Vec<String> = Vec::new();
    for sha in shas {
        let key = format!("{}{}", SHA_COUNT_KEY_PREFIX, sha);
        let exists = redis_connection
            .exists::<&str, u8>(key.as_str())
            .await
            .map_err(|e| {
                anyhow::Error::msg(format!("unable to check exists for key {key} {:?}", e))
            })?;
        if exists == 0 {
            results.push(sha);
        }
    }

    Ok(results)
}

#[cfg(test)]
#[cfg(feature = "redis_cluster_test")]
mod tests {
    use super::*;
    use redis::Commands;

    #[tokio::test]
    #[ignore = "Redis cluster doesn't exist in CI"]
    async fn test_exists() {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        // Cleanup from previous test runs
        conn.del::<&str, bool>("sha:test_exists_two").unwrap();

        let _ = conn.set::<&str, i32, i32>("sha:test_exists_two", 2);

        let res = exists(&redis_client, &"sha:test_exists_one").await;
        assert_eq!(res.is_ok(), true);
        assert_eq!(res.unwrap(), false);

        let res = exists(&redis_client, &"sha:test_exists_two").await;
        assert_eq!(res.is_ok(), true);
        assert_eq!(res.unwrap(), true);
    }

    #[tokio::test]
    #[ignore = "Redis cluster doesn't exist in CI"]
    async fn test_find_non_existing_shas() {
        let redis_client = redis::cluster::ClusterClient::new(vec!["redis://localhost:6369"])
            .expect("could not connect to redis client");

        let mut conn = redis_client
            .get_connection()
            .expect("unable to connect to redis");

        // Cleanup from previous test runs
        conn.del::<&str, bool>("sha:test_find_non_two").unwrap();

        let _ = conn.set::<&str, i32, i32>("sha:test_find_non_two", 2);

        let res = find_non_existing_shas(
            &redis_client,
            &vec![
                SaveBomPart {
                    sha: "test_find_non_one".to_string(),
                    path: "".to_string(),
                },
                SaveBomPart {
                    sha: "test_find_non_two".to_string(),
                    path: "".to_string(),
                },
            ],
        )
        .await;

        assert_eq!(res.is_ok(), true);
        assert_eq!(
            res.unwrap(),
            vec![SaveBomPart {
                sha: "test_find_non_one".to_string(),
                path: "".to_string(),
            }]
        );
    }
}
