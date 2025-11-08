use sqlx::{Pool, Postgres, Row};

use model::{activity::Activity, chat::Chat, document::BasicDocument};

#[tracing::instrument(skip(db))]
pub async fn get_recent_activities(
    db: Pool<Postgres>,
    user_id: &str,
    limit: i64,
    offset: i64,
) -> anyhow::Result<(Vec<Activity>, i64)> {
    let mut transaction = db.begin().await?;
    let total_documents = sqlx::query!(
        r#"
        SELECT COUNT(*) as "count"
        FROM "Document"
        WHERE owner = $1 AND "deletedAt" IS NULL
        "#,
        user_id,
    )
    .fetch_one(&mut *transaction)
    .await?
    .count
    .unwrap_or(0);

    let total_chats = sqlx::query!(
        r#"
        SELECT COUNT(*) as "count"
        FROM "Chat"
        WHERE "userId" = $1 AND "deletedAt" IS NULL
        "#,
        user_id,
    )
    .fetch_one(&mut *transaction)
    .await?
    .count
    .unwrap_or(0);

    if total_documents == 0 && total_chats == 0 {
        return Ok((vec![], 0));
    }

    let query = r#"
        SELECT
            'document' as type,
            d.id as id,
            d.owner as user_id,
            d.name as "name",
            CAST(COALESCE(db.id, di.id) as TEXT) as "document_version_id",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."fileType" as "file_type",
            d."createdAt"::timestamptz as "created_at",
            d."updatedAt"::timestamptz as "updated_at",
            d."projectId" as "project_id",
            NULL as "is_persistent",
            di.sha as "sha"
        FROM
            "Document" d
        LEFT JOIN LATERAL (
            SELECT
                b.id
            FROM
                "DocumentBom" b
            WHERE
                b."documentId" = d.id
            ORDER BY
                b."createdAt" DESC
            LIMIT 1
        ) db ON d."fileType" = 'docx'
        LEFT JOIN LATERAL (
            SELECT
                i.id,
                i."documentId",
                i."sha",
                i."createdAt",
                i."updatedAt"
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            ORDER BY
                i."updatedAt" DESC
            LIMIT 1
        ) di ON d."fileType" IS DISTINCT FROM 'docx'
        WHERE
        d.owner = $1 AND d."deletedAt" IS NULL
        UNION ALL
        SELECT
            'chat' as type,
            c.id as id,
            c."userId" as user_id,
            c.name as "name",
            NULL as "document_version_id",
            NULL as "branched_from_id",
            NULL as "branched_from_version_id",
            NULL as "document_family_id",
            NULL as "file_type",
            c."createdAt"::timestamptz as "created_at",
            c."updatedAt"::timestamptz as "updated_at",
            c."projectId" as "project_id",
            c."isPersistent" as "is_persistent",
            NULL as "sha"
        FROM "Chat" c
        WHERE c."userId" = $1 AND c."deletedAt" IS NULL
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3
        "#;

    let rows = sqlx::query(query)
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut *transaction)
        .await?;

    let activities: Vec<Activity> = rows
        .iter()
        .filter_map(|r| {
            let row_type: String = r.get("type");
            let id: String = r.get("id");
            let user_id: String = r.get("user_id");
            let name: String = r.get("name");
            let created_at: Option<chrono::DateTime<chrono::Utc>> = r.get("created_at");
            let updated_at: Option<chrono::DateTime<chrono::Utc>> = r.get("updated_at");
            let project_id: Option<String> = r.get("project_id");

            match row_type.as_ref() {
                "document" => {
                    let document_version_id: String = r.get("document_version_id");
                    Some(Activity::Document(BasicDocument {
                        document_id: id,
                        owner: user_id,
                        document_version_id: document_version_id.parse::<i64>().unwrap(),
                        document_name: name,
                        created_at,
                        updated_at,
                        deleted_at: None, // Don't care about the deleted_at in activity
                        sha: r.get("sha"),
                        file_type: r.get("file_type"),
                        document_family_id: r.get("document_family_id"),
                        branched_from_id: r.get("branched_from_id"),
                        branched_from_version_id: r.get("branched_from_version_id"),
                        project_id,
                    }))
                }
                "chat" => Some(Activity::Chat(Chat {
                    id,
                    name,
                    // Don't care about the model in user history
                    model: None,
                    user_id,
                    created_at,
                    updated_at,
                    deleted_at: None, // Don't care about the deleted_at in activity
                    project_id,
                    token_count: None,
                    is_persistent: r.get("is_persistent"),
                })),
                _ => {
                    tracing::error!(row_type=?row_type, id=?id, "unexpected activity type");
                    None
                }
            }
        })
        .collect::<Vec<_>>();

    Ok((activities, total_chats + total_documents))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_get_recent_actitivties(pool: Pool<Postgres>) {
        let result = get_recent_activities(pool.clone(), "no-user", 10, 0)
            .await
            .unwrap();
        assert_eq!(result.0.len(), 0);
        assert_eq!(result.1, 0);

        // 7 documents and 3 chats
        let recent = get_recent_activities(pool.clone(), "macro|user@user.com", 100, 0)
            .await
            .unwrap();
        assert_eq!(recent.0.len(), 10);
        assert_eq!(recent.1, 10);

        match recent.0[0] {
            Activity::Chat(_) => (),
            _ => panic!("Unexpected activity type 1"),
        }
        match recent.0[1] {
            Activity::Chat(_) => (),
            _ => panic!("Unexpected activity type 2"),
        }
        match recent.0[2] {
            Activity::Document(_) => (),
            _ => panic!("Unexpected activity type 3"),
        }
    }
}
