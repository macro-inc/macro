use model::thread::EmailThreadPermission;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use std::str::FromStr;

#[tracing::instrument(skip(db))]
pub async fn get_share_permission_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<String> {
    let share_permission_id = match item_type {
        "document" => {
            sqlx::query!(
                r#"
                    SELECT
                        sp.id as id
                    FROM
                        "DocumentPermission" dp
                    JOIN "SharePermission" sp ON dp."sharePermissionId" = sp.id
                    WHERE
                        dp."documentId" = $1
                "#,
                item_id,
            )
            .fetch_one(db)
            .await?
            .id
        }
        "chat" => {
            sqlx::query!(
                r#"
                    SELECT
                        sp.id as id
                    FROM
                        "ChatPermission" cp
                    JOIN "SharePermission" sp ON cp."sharePermissionId" = sp.id
                    WHERE
                        cp."chatId" = $1
                "#,
                item_id,
            )
            .fetch_one(db)
            .await?
            .id
        }
        "thread" => {
            sqlx::query!(
                r#"
                    SELECT
                        sp.id as id
                    FROM
                        "EmailThreadPermission" tp
                    JOIN "SharePermission" sp ON tp."sharePermissionId" = sp.id
                    WHERE
                        tp."threadId" = $1
                "#,
                item_id,
            )
            .fetch_one(db)
            .await?
            .id
        }
        "project" => {
            sqlx::query!(
                r#"
                    SELECT
                        sp.id as id
                    FROM
                        "ProjectPermission" pp
                    JOIN "SharePermission" sp ON pp."sharePermissionId" = sp.id
                    WHERE
                        pp."projectId" = $1
                "#,
                item_id,
            )
            .fetch_one(db)
            .await?
            .id
        }
        _ => {
            return Err(anyhow::anyhow!(format!(
                "unsupported item type {item_type}"
            )));
        }
    };

    Ok(share_permission_id)
}

#[tracing::instrument(skip(db))]
pub async fn get_project_share_permission(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<SharePermissionV2> {
    let result = sqlx::query!(
        r#"
            SELECT
                sp.id as id,
                sp."isPublic" as is_public,
                sp."publicAccessLevel" as "public_access_level?",
                p."userId" as owner,
                COALESCE(
                    json_agg(json_build_object(
                        'channel_id', csp."channel_id",
                        'access_level', csp."access_level"
                    )) FILTER (WHERE csp."channel_id" IS NOT NULL),
                    '[]'
                ) as "channel_share_permissions?"
            FROM
                "ProjectPermission" pp
            JOIN "SharePermission" sp ON pp."sharePermissionId" = sp.id
            JOIN "Project" p ON pp."projectId" = p.id
            LEFT JOIN "ChannelSharePermission" csp ON csp."share_permission_id" = sp.id
            WHERE
                pp."projectId" = $1
            GROUP BY
                sp.id, p."userId"
        "#,
        project_id,
    )
    .fetch_one(db)
    .await?;

    let channel_share_permissions: Option<Vec<ChannelSharePermission>> =
        if let Some(channel_share_permissions) = result.channel_share_permissions {
            let channel_share_permissions: Vec<ChannelSharePermission> =
                serde_json::from_value(channel_share_permissions)?;
            match channel_share_permissions.is_empty() {
                true => None,
                false => Some(channel_share_permissions),
            }
        } else {
            None
        };

    let public_access_level: Option<AccessLevel> = result
        .public_access_level
        .map(|s| AccessLevel::from_str(&s).unwrap());

    Ok(SharePermissionV2 {
        id: result.id,
        is_public: result.is_public,
        public_access_level,
        owner: result.owner,
        channel_share_permissions,
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_document_share_permission(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
) -> anyhow::Result<SharePermissionV2> {
    let result = sqlx::query!(
        r#"
            SELECT
                sp.id as id,
                sp."isPublic" as is_public,
                sp."publicAccessLevel" as "public_access_level?",
                d."owner" as owner,
                COALESCE(
                    json_agg(json_build_object(
                        'channel_id', csp."channel_id",
                        'access_level', csp."access_level"
                    )) FILTER (WHERE csp."channel_id" IS NOT NULL),
                    '[]'
                ) as "channel_share_permissions?"
            FROM
                "DocumentPermission" dp
            JOIN "SharePermission" sp ON dp."sharePermissionId" = sp.id
            JOIN "Document" d ON dp."documentId" = d.id
            LEFT JOIN "ChannelSharePermission" csp ON csp."share_permission_id" = sp.id
            WHERE
                dp."documentId" = $1
            GROUP BY
                sp.id, d."owner"
        "#,
        document_id,
    )
    .fetch_one(db)
    .await?;

    let channel_share_permissions: Option<Vec<ChannelSharePermission>> =
        if let Some(channel_share_permissions) = result.channel_share_permissions {
            let channel_share_permissions: Vec<ChannelSharePermission> =
                serde_json::from_value(channel_share_permissions)?;
            match channel_share_permissions.is_empty() {
                true => None,
                false => Some(channel_share_permissions),
            }
        } else {
            None
        };

    let public_access_level: Option<AccessLevel> = result
        .public_access_level
        .map(|s| AccessLevel::from_str(&s).unwrap());

    Ok(SharePermissionV2 {
        id: result.id,
        is_public: result.is_public,
        public_access_level,
        owner: result.owner,
        channel_share_permissions,
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_chat_share_permission(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
) -> anyhow::Result<SharePermissionV2> {
    let result = sqlx::query!(
        r#"
            SELECT
                sp.id as id,
                sp."isPublic" as is_public,
                sp."publicAccessLevel" as "public_access_level?",
                c."userId" as owner,
                COALESCE(
                    json_agg(json_build_object(
                        'channel_id', csp."channel_id",
                        'access_level', csp."access_level"
                    )) FILTER (WHERE csp."channel_id" IS NOT NULL),
                    '[]'
                ) as "channel_share_permissions?"
            FROM
                "ChatPermission" cp
            JOIN "SharePermission" sp ON cp."sharePermissionId" = sp.id
            JOIN "Chat" c ON cp."chatId" = c.id
            LEFT JOIN "ChannelSharePermission" csp ON csp."share_permission_id" = sp.id
            WHERE
                cp."chatId" = $1
            GROUP BY
                sp.id, c."userId"
        "#,
        chat_id,
    )
    .fetch_one(db)
    .await?;

    let channel_share_permissions: Option<Vec<ChannelSharePermission>> =
        if let Some(channel_share_permissions) = result.channel_share_permissions {
            let channel_share_permissions: Vec<ChannelSharePermission> =
                serde_json::from_value(channel_share_permissions)?;
            match channel_share_permissions.is_empty() {
                true => None,
                false => Some(channel_share_permissions),
            }
        } else {
            None
        };

    let public_access_level: Option<AccessLevel> = result
        .public_access_level
        .map(|s| AccessLevel::from_str(&s).unwrap());

    Ok(SharePermissionV2 {
        id: result.id,
        is_public: result.is_public,
        public_access_level,
        owner: result.owner,
        channel_share_permissions,
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_macro_share_permission(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_prompt_id: &str,
) -> anyhow::Result<SharePermissionV2> {
    let result = sqlx::query!(
        r#"
        SELECT
                sp.id as id,
                sp."isPublic" as is_public,
                sp."publicAccessLevel" as "public_access_level?",
                m."user_id" as owner,
                COALESCE(
                    json_agg(json_build_object(
                        'channel_id', csp."channel_id",
                        'access_level', csp."access_level"
                    )) FILTER (WHERE csp."channel_id" IS NOT NULL),
                    '[]'
                ) as "channel_share_permissions?"
            FROM
                "MacroPromptPermission" mpp
            JOIN "SharePermission" sp ON mpp."share_permission_id" = sp.id
            JOIN "MacroPrompt" m ON mpp."macro_prompt_id" = m.id
            LEFT JOIN "ChannelSharePermission" csp ON csp."share_permission_id" = sp.id
            WHERE
                mpp."macro_prompt_id" = $1
            GROUP BY
                sp.id, m."user_id"
        "#,
        macro_prompt_id,
    )
    .fetch_one(db)
    .await?;

    let channel_share_permissions: Option<Vec<ChannelSharePermission>> =
        if let Some(channel_share_permissions) = result.channel_share_permissions {
            let channel_share_permissions: Vec<ChannelSharePermission> =
                serde_json::from_value(channel_share_permissions)?;
            match channel_share_permissions.is_empty() {
                true => None,
                false => Some(channel_share_permissions),
            }
        } else {
            None
        };

    let public_access_level: Option<AccessLevel> = result
        .public_access_level
        .map(|s| AccessLevel::from_str(&s).unwrap());

    Ok(SharePermissionV2 {
        id: result.id,
        is_public: result.is_public,
        public_access_level,
        owner: result.owner,
        channel_share_permissions,
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_email_thread_permission(
    db: &sqlx::Pool<sqlx::Postgres>,
    thread_id: &str,
) -> anyhow::Result<Option<EmailThreadPermission>> {
    let result = sqlx::query!(
        r#"
        SELECT 
            "threadId" as thread_id,
            "sharePermissionId" as share_permission_id,
            "userId" as user_id,
            "projectId" as project_id
        FROM "EmailThreadPermission"
        WHERE "threadId" = $1
        "#,
        thread_id
    )
    .fetch_optional(db)
    .await?;

    Ok(result.map(|row| EmailThreadPermission {
        thread_id: row.thread_id,
        share_permission_id: row.share_permission_id,
        user_id: row.user_id,
        project_id: row.project_id,
    }))
}

/// Retrieves all document, chat, and project IDs associated with the given share permission IDs
/// Returns a map where the key is the share_permission_id, and the value is a tuple containing the
/// item id and type
#[tracing::instrument(skip(db))]
pub async fn get_items_by_share_permission_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    share_permission_ids: &[String],
) -> anyhow::Result<std::collections::HashMap<String, (String, String)>> {
    if share_permission_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    // Create a single query using UNION to get all types of items at once
    let rows = sqlx::query!(
        r#"
        SELECT 'document' as "item_type!", "documentId" as "item_id!", "sharePermissionId" as "share_permission_id!"
        FROM "DocumentPermission"
        WHERE "sharePermissionId" = ANY($1)
        UNION ALL
        SELECT 'chat' as "item_type!", "chatId" as "item_id!", "sharePermissionId" as "share_permission_id!"
        FROM "ChatPermission"
        WHERE "sharePermissionId" = ANY($1)
        UNION ALL
        SELECT 'project' as "item_type!", "projectId" as "item_id!", "sharePermissionId" as "share_permission_id!"
        FROM "ProjectPermission"
        WHERE "sharePermissionId" = ANY($1)
        UNION ALL
        SELECT 'thread' as "item_type!", "threadId" as "item_id!", "sharePermissionId" as "share_permission_id!"
        FROM "EmailThreadPermission"
        WHERE "sharePermissionId" = ANY($1)
        "#,
        share_permission_ids
    )
    .fetch_all(db)
    .await?;

    // create map for associating share_permission_id to item
    let mut items_map = std::collections::HashMap::new();
    for row in rows {
        items_map.insert(row.share_permission_id, (row.item_id, row.item_type));
    }

    Ok(items_map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("channel_share_permissions")))]
    async fn test_get_project_share_permission(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let permission = get_project_share_permission(&pool, "p1").await?;
        assert_eq!(permission.id, "sp-p1".to_string());
        assert!(permission.is_public);
        assert_eq!(permission.public_access_level, Some(AccessLevel::Edit));
        assert_eq!(permission.owner, "macro|user@user.com".to_string());
        assert_eq!(
            permission.channel_share_permissions,
            Some(vec![
                ChannelSharePermission {
                    channel_id: "c1".to_string(),
                    access_level: AccessLevel::View,
                },
                ChannelSharePermission {
                    channel_id: "c2".to_string(),
                    access_level: AccessLevel::Edit,
                }
            ])
        );

        let permission = get_project_share_permission(&pool, "p2").await?;
        assert_eq!(permission.id, "sp-p2".to_string());
        assert!(!permission.is_public);
        assert!(permission.public_access_level.is_none());
        assert_eq!(permission.owner, "macro|user2@user.com".to_string());
        assert!(permission.channel_share_permissions.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("channel_share_permissions")))]
    async fn test_get_document_share_permission(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let permission = get_document_share_permission(&pool, "d1").await?;
        assert_eq!(permission.id, "sp-d1".to_string());
        assert!(permission.is_public);
        assert_eq!(permission.public_access_level, Some(AccessLevel::Edit));
        assert_eq!(permission.owner, "macro|user@user.com".to_string());
        assert_eq!(
            permission.channel_share_permissions,
            Some(vec![
                ChannelSharePermission {
                    channel_id: "c1".to_string(),
                    access_level: AccessLevel::View,
                },
                ChannelSharePermission {
                    channel_id: "c2".to_string(),
                    access_level: AccessLevel::Edit,
                }
            ])
        );

        let permission = get_document_share_permission(&pool, "d2").await?;
        assert_eq!(permission.id, "sp-d2".to_string());
        assert!(!permission.is_public);
        assert!(permission.public_access_level.is_none());
        assert_eq!(permission.owner, "macro|user2@user.com".to_string());
        assert!(permission.channel_share_permissions.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("channel_share_permissions")))]
    async fn test_get_chat_share_permission(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let permission = get_chat_share_permission(&pool, "c1").await?;
        assert_eq!(permission.id, "sp-c1".to_string());
        assert!(permission.is_public);
        assert_eq!(permission.public_access_level, Some(AccessLevel::Edit));
        assert_eq!(permission.owner, "macro|user@user.com".to_string());
        assert_eq!(
            permission.channel_share_permissions,
            Some(vec![
                ChannelSharePermission {
                    channel_id: "c1".to_string(),
                    access_level: AccessLevel::View,
                },
                ChannelSharePermission {
                    channel_id: "c2".to_string(),
                    access_level: AccessLevel::Edit,
                }
            ])
        );

        let permission = get_chat_share_permission(&pool, "c2").await?;
        assert_eq!(permission.id, "sp-c2".to_string());
        assert!(!permission.is_public);
        assert!(permission.public_access_level.is_none());
        assert_eq!(permission.owner, "macro|user2@user.com".to_string());
        assert!(permission.channel_share_permissions.is_none());

        Ok(())
    }
}
