use crate::parse::db_to_service;
use crate::{attachments, contacts, labels, messages};
use anyhow::{Context, anyhow};
use futures::future::try_join_all;
use models_email::email::db;
use models_email::email::service::thread::{
    ThreadProviderMap, ThreadUserInfo, UserThreadIds, UserThreadsPage,
};
use models_email::email::service::{message, thread};
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::collections::{HashMap, HashSet};

/// gets a list of thread ids with the macro user id for the user
#[tracing::instrument(skip(pool))]
pub async fn get_paginated_thread_ids_with_macro_user_id(
    pool: &PgPool,
    thread_limit: i64,
    thread_offset: i64,
) -> anyhow::Result<Vec<(Uuid, String)>> {
    let result = sqlx::query!(
        r#"
        SELECT t.id, l.macro_id
        FROM email_threads t
        JOIN email_links l ON t.link_id = l.id
        ORDER BY t.latest_inbound_message_ts DESC NULLS LAST
        LIMIT $1 OFFSET $2
        "#,
        thread_limit,
        thread_offset
    )
    .map(|row| (row.id, row.macro_id))
    .fetch_all(pool)
    .await
    .context("Failed to fetch thread ids with macro user id")?;

    Ok(result)
}

/// fetch thread with number of most recent messages specified by limit and offset
#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_thread_with_messages_paginated(
    pool: &PgPool,
    thread_db_id: Uuid,
    offset: i64,
    limit: i64,
) -> anyhow::Result<thread::Thread> {
    if offset < 0 || limit <= 0 {
        return Err(anyhow!(
            "Offset must be non-negative and limit must be positive"
        ));
    }

    let db_thread = sqlx::query_as!(
        db::thread::Thread,
        r#"
    SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
           t.latest_inbound_message_ts, t.latest_outbound_message_ts,
           t.latest_non_spam_message_ts, t.created_at, t.updated_at
    FROM email_threads t
    WHERE t.id = $1
    "#,
        thread_db_id,
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to fetch thread with DB ID {}", thread_db_id))?
    .ok_or_else(|| anyhow!("Thread with ID {} not found", thread_db_id,))?;

    let db_messages = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT 
            id,
            provider_id,
            global_id,
            thread_id,
            provider_thread_id,
            replying_to_id,
            link_id,
            provider_history_id,
            internal_date_ts,
            snippet,
            size_estimate,
            subject,
            from_contact_id,
            sent_at,
            has_attachments,
            is_read,
            is_starred,
            is_sent,
            is_draft,
            body_text,
            body_html_sanitized,
            body_macro,
            headers_jsonb,
            created_at,
            updated_at
        FROM email_messages
        WHERE thread_id = $1
        ORDER BY internal_date_ts DESC
        LIMIT $2 OFFSET $3
        "#,
        thread_db_id,
        limit,
        offset
    )
    .fetch_all(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch paginated messages for thread DB ID {}",
            thread_db_id
        )
    })?;

    // concurrently fetch data for each message
    let mut message_processing_futures = Vec::new();

    for db_message in db_messages {
        let pool_clone = pool.clone();
        message_processing_futures.push(async move {
            // fetch data from each table concurrently
            let (
                sender_res,
                recipients_res,
                scheduled_res,
                labels_res,
                attachments_res,
                macro_attachments_res,
            ) = tokio::try_join!(
                async {
                    if let Some(id) = db_message.from_contact_id {
                        contacts::get::get_contact_by_id(&pool_clone, id).await
                    } else {
                        Ok(None)
                    }
                },
                contacts::get::fetch_db_recipients(&pool_clone, db_message.id),
                messages::scheduled::get_scheduled_message_no_auth(&pool_clone, db_message.id),
                labels::get::fetch_message_labels(&pool_clone, db_message.id),
                async {
                    if db_message.has_attachments {
                        attachments::provider::fetch_db_attachments(&pool_clone, db_message.id)
                            .await
                    } else {
                        Ok(Vec::new())
                    }
                },
                async {
                    attachments::marco::fetch_db_macro_attachments(&pool_clone, db_message.id).await
                }
            )?;

            // parse db-layer structs into service-layer message struct
            db_to_service::map_db_message_to_service(
                db_message,
                sender_res,
                recipients_res,
                scheduled_res,
                labels_res,
                attachments_res,
                macro_attachments_res,
            )
        });
    }

    // Wait for all message processing futures to complete
    let processed_messages: Vec<message::Message> = try_join_all(message_processing_futures)
        .await
        .context("Failed processing messages concurrently")?;

    let full_thread = db_to_service::map_db_thread_to_service(db_thread, processed_messages);

    Ok(full_thread)
}

/// get the ids of the latest-updated threads for the user.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_latest_thread_ids_paginated(
    pool: &PgPool,
    fusionauth_user_id: &str,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<Uuid>> {
    if offset < 0 || limit <= 0 {
        return Err(anyhow!(
            "Offset must be non-negative and limit must be positive"
        ));
    }

    let thread_ids = sqlx::query_scalar!(
        r#"
        SELECT t.id
        FROM email_threads t
        JOIN email_links l ON t.link_id = l.id
        WHERE l.fusionauth_user_id = $1
        ORDER BY t.latest_inbound_message_ts DESC NULLS LAST
        LIMIT $2 OFFSET $3
        "#,
        fusionauth_user_id,
        limit,
        offset
    )
        .fetch_all(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch latest thread IDs for links associated with user {} with limit {} offset {}",
                fusionauth_user_id, limit, offset
            )
        })?;

    Ok(thread_ids)
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_threads_by_link_id_and_provider_ids(
    pool: &PgPool,
    link_id: Uuid,
    provider_ids: &HashSet<String>,
) -> anyhow::Result<ThreadProviderMap> {
    if provider_ids.is_empty() {
        return Ok(ThreadProviderMap::new());
    }

    let provider_ids_vec: Vec<String> = provider_ids.iter().cloned().collect();

    // Execute the query with query! macro for compile-time SQL verification
    let rows = sqlx::query!(
        r#"
        SELECT id, provider_id as "provider_id!"
        FROM email_threads
        WHERE link_id = $1
        AND provider_id = ANY($2)
        "#,
        link_id,
        &provider_ids_vec
    )
    .fetch_all(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch threads by link_id {} and provider_ids {:?}",
            link_id, provider_ids_vec
        )
    })?;

    // Build the result map
    let thread_map = rows
        .into_iter()
        .map(|row| (row.provider_id, row.id))
        .collect();

    Ok(thread_map)
}

/// For a user, get threads where user has sent a message, paginated.
pub async fn get_threads_by_user_with_outbound(
    pool: &PgPool,
    macro_user_id: &str,
    limit: i64,
    offset: i64,
) -> anyhow::Result<UserThreadsPage> {
    let rows = sqlx::query!(
        r#"
        SELECT t.id as thread_id
        FROM email_threads t
        JOIN email_links l ON t.link_id = l.id
        WHERE l.macro_id = $1
          AND t.latest_outbound_message_ts IS NOT NULL
        ORDER BY t.latest_outbound_message_ts DESC
        LIMIT $2 OFFSET $3
        "#,
        macro_user_id,
        limit + 1,
        offset
    )
    .fetch_all(pool)
    .await?;
    let is_complete = rows.len() <= limit as usize;
    let threads = rows
        .into_iter()
        .take(limit as usize)
        .map(|r| ThreadUserInfo {
            thread_id: r.thread_id,
        })
        .collect();
    Ok(UserThreadsPage {
        threads,
        is_complete,
    })
}

/// For a list of user to thread IDs, filter out threads where user has not sent a message
pub async fn get_outbound_threads_by_thread_ids(
    pool: &PgPool,
    user_thread_ids: Vec<UserThreadIds>,
) -> anyhow::Result<Vec<UserThreadIds>> {
    // Flatten for one query
    let mut macro_id_and_thread_id_pairs = Vec::new();
    for user in &user_thread_ids {
        for thread_id in &user.thread_ids {
            macro_id_and_thread_id_pairs.push((user.macro_user_id.clone(), *thread_id));
        }
    }

    // Early exit if empty
    if macro_id_and_thread_id_pairs.is_empty() {
        return Ok(vec![]);
    }

    // Extract for query
    let macro_ids: Vec<String> = macro_id_and_thread_id_pairs
        .iter()
        .map(|x| x.0.clone())
        .collect();
    let thread_ids: Vec<Uuid> = macro_id_and_thread_id_pairs.iter().map(|x| x.1).collect();

    // The trick: Use UNNEST to join pairs in SQL
    let rows = sqlx::query!(
        r#"
        SELECT l.macro_id, t.id as thread_id
        FROM UNNEST($1::text[], $2::uuid[]) AS inp(macro_id, thread_id)
        JOIN email_links l ON l.macro_id = inp.macro_id
        JOIN email_threads t ON t.link_id = l.id AND t.id = inp.thread_id
        WHERE t.latest_outbound_message_ts IS NOT NULL
        "#,
        &macro_ids,
        &thread_ids,
    )
    .fetch_all(pool)
    .await?;

    // Group by macro_user_id
    let mut threads_by_user: HashMap<String, Vec<Uuid>> = HashMap::new();
    for row in rows {
        threads_by_user
            .entry(row.macro_id)
            .or_default()
            .push(row.thread_id);
    }

    // Reconstruct output matching input shape, with filtered thread_ids
    let result = user_thread_ids
        .into_iter()
        .filter_map(|user| {
            threads_by_user
                .get(&user.macro_user_id)
                .map(|filtered_ids| UserThreadIds {
                    macro_user_id: user.macro_user_id,
                    thread_ids: filtered_ids.clone(),
                })
        })
        .filter(|user| !user.thread_ids.is_empty())
        .collect();

    Ok(result)
}

#[tracing::instrument(skip(pool))]
pub async fn get_provider_id_by_link_and_thread_id(
    pool: &PgPool,
    link_id: Uuid,
    thread_db_id: Uuid,
) -> anyhow::Result<Option<String>> {
    let provider_id = sqlx::query_scalar!(
        r#"
        SELECT provider_id
        FROM email_threads
        WHERE link_id = $1 AND id = $2
        "#,
        link_id,
        thread_db_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch provider_id for thread ID {} with link_id {}",
            thread_db_id, link_id
        )
    })?
    .flatten();

    Ok(provider_id)
}

#[tracing::instrument(skip(pool))]
pub async fn get_macro_id_from_thread_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> anyhow::Result<Option<String>> {
    let macro_id = sqlx::query_scalar!(
        r#"
        SELECT l.macro_id
        FROM email_threads t
        JOIN email_links l ON t.link_id = l.id
        WHERE t.id = $1
        "#,
        thread_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to fetch macro_id for thread ID {}", thread_id))?;

    Ok(macro_id)
}

/// Gets a single thread by ID and link_ID
#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_thread_by_id_and_link_id(
    pool: &PgPool,
    thread_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Option<thread::Thread>> {
    // Fetch the thread record
    let db_thread = sqlx::query_as!(
        db::thread::Thread,
        r#"
        SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
               t.latest_inbound_message_ts, t.latest_outbound_message_ts,
               t.latest_non_spam_message_ts, t.created_at, t.updated_at
        FROM email_threads t
        WHERE t.id = $1 AND t.link_id = $2
        "#,
        thread_id,
        link_id,
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch thread with ID {} and link_id {}",
            thread_id, link_id
        )
    })?;

    // If no thread found, return None
    if let Some(db_thread) = db_thread {
        // Convert DB thread to service thread without messages
        let thread = db_to_service::map_db_thread_to_service(db_thread, vec![]);
        Ok(Some(thread))
    } else {
        Ok(None)
    }
}

/// Returns a paginated list of thread IDs, sorting by ascending so we don't miss new ones
#[tracing::instrument(skip(db))]
pub async fn get_all_thread_ids_paginated(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT
            id as "thread_id"
        FROM
            email_threads
        ORDER BY
            created_at ASC
        LIMIT $1
        OFFSET $2
        "#,
        limit,
        offset
    )
    .map(|row| row.thread_id.to_string())
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use models_email::email::service::thread::UserThreadIds;
    use sqlx::types::uuid::uuid;
    use sqlx::{Pool, Postgres};
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("links", "threads"))
    )]
    async fn test_get_threads_by_users_with_outbound(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let user1 = "macro|user1@macro.com";
        let user2 = "macro|user2@macro.com";

        // Test per-user pagination (limit 2, offset 0)
        let res = get_threads_by_user_with_outbound(&pool, user1, 2, 0).await?;
        assert_eq!(res.threads.len(), 2);

        let res2 = get_threads_by_user_with_outbound(&pool, user1, 2, 1).await?;
        assert_eq!(res2.threads.len(), 1);
        assert_eq!(
            res2.threads[0].thread_id.to_string(),
            "10000000-0000-0000-0000-000000000002"
        );

        let res3 = get_threads_by_user_with_outbound(&pool, user2, 2, 0).await?;
        assert_eq!(res3.threads.len(), 1);
        assert_eq!(
            res3.threads[0].thread_id.to_string(),
            "10000000-0000-0000-0000-000000000003"
        );

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("links", "threads"))
    )]
    async fn test_get_outbound_threads_by_thread_ids_basic(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // user1: threads 1 and 2, user2: thread 3
        let user1 = "macro|user1@macro.com".to_string();
        let user2 = "macro|user2@macro.com".to_string();

        let user_thread_ids = vec![
            UserThreadIds {
                macro_user_id: user1.clone(),
                thread_ids: vec![
                    uuid!("10000000-0000-0000-0000-000000000001"),
                    uuid!("10000000-0000-0000-0000-000000000002"),
                ],
            },
            UserThreadIds {
                macro_user_id: user2.clone(),
                thread_ids: vec![uuid!("10000000-0000-0000-0000-000000000003")],
            },
        ];

        let result = get_outbound_threads_by_thread_ids(&pool, user_thread_ids).await?;

        assert_eq!(result.len(), 2);

        // user1 should get both threads if both have outbound, or only those that do
        let user1_result = result.iter().find(|u| u.macro_user_id == user1).unwrap();
        assert!(!user1_result.thread_ids.is_empty());
        assert!(
            user1_result
                .thread_ids
                .iter()
                .all(|id| *id == uuid!("10000000-0000-0000-0000-000000000001")
                    || *id == uuid!("10000000-0000-0000-0000-000000000002"))
        );

        // user2 should get thread 3 if it has outbound
        let user2_result = result.iter().find(|u| u.macro_user_id == user2).unwrap();
        assert_eq!(
            user2_result.thread_ids,
            vec![uuid!("10000000-0000-0000-0000-000000000003")]
        );

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("links", "threads"))
    )]
    async fn test_get_outbound_threads_by_thread_ids_empty_input(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let result = get_outbound_threads_by_thread_ids(&pool, vec![]).await?;
        assert!(result.is_empty());
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("links", "threads"))
    )]
    async fn test_get_outbound_threads_by_thread_ids_user_no_outbound(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // Assume user3 has no threads with outbound
        let user3 = "macro|user3@macro.com".to_string();

        let user_thread_ids = vec![UserThreadIds {
            macro_user_id: user3.clone(),
            thread_ids: vec![
                uuid!("10000000-0000-0000-0000-000000000004"),
                uuid!("10000000-0000-0000-0000-000000000005"),
            ],
        }];

        let result = get_outbound_threads_by_thread_ids(&pool, user_thread_ids).await?;
        assert!(result.is_empty());
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("links", "threads"))
    )]
    async fn test_get_outbound_threads_by_thread_ids_partial_match(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user1 = "macro|user1@macro.com".to_string();

        // Only one thread has outbound
        let user_thread_ids = vec![UserThreadIds {
            macro_user_id: user1.clone(),
            thread_ids: vec![
                uuid!("10000000-0000-0000-0000-000000000001"), // assume has outbound
                uuid!("10000000-0000-0000-0000-00000000dead"), // does not exist
            ],
        }];

        let result = get_outbound_threads_by_thread_ids(&pool, user_thread_ids).await?;
        assert_eq!(result.len(), 1);

        let found = &result[0];
        assert_eq!(found.macro_user_id, user1);
        assert!(
            found
                .thread_ids
                .contains(&uuid!("10000000-0000-0000-0000-000000000001"))
        );
        assert_eq!(found.thread_ids.len(), 1); // only the valid one returned

        Ok(())
    }
}
