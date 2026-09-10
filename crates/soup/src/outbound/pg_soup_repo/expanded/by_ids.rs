use crate::{
    domain::models::SoupProjectionHydration, map_soup_projection_hydration,
    outbound::pg_soup_repo::type_err,
};
use document_sub_type::DocumentSubType;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::{Entity, EntityType};
#[cfg(test)]
use models_soup::item::SoupItem;
use sqlx::PgPool;
use std::str::FromStr;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

/// Returns objects that a user has EXPLICIT and IMPLICIT access to by their IDs, excluding project items.
///
/// This function returns all requested items the user can access, including those with inherited
/// permissions through project hierarchy. If a user has access to a project that contains
/// the requested items, those items WILL be included in the results even if the user doesn't
/// have explicit permissions on them. Project items themselves are excluded from results -
/// only documents and chats are returned. Result order is unspecified.
#[tracing::instrument(err, skip(db, entities))]
async fn expanded_soup_by_ids_hydrated<'a>(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    entities: impl IntoIterator<Item = &'a Entity<'a>>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
    let mut document_ids = Vec::new();
    let mut chat_ids = Vec::new();

    entities.into_iter().for_each(|e| match e.entity_type {
        EntityType::Chat => chat_ids.push(e.entity_id.to_string()),
        EntityType::Document => document_ids.push(e.entity_id.to_string()),
        EntityType::Project => {} // Projects are excluded from expanded soup
        _ => {}
    });

    if document_ids.is_empty() && chat_ids.is_empty() {
        return Ok(Vec::new());
    }

    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let assignees_property_id = SystemPropertyKey::ASSIGNEES_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();

    let items: Vec<SoupProjectionHydration> = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        ),
        UserAccessibleItems AS (
            SELECT DISTINCT
                ea.entity_id::text as item_id,
                ea.entity_type as item_type
            FROM entity_access ea
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
        ),
        Combined AS (
            SELECT
                'document' as "item_type!",
                d.id as "id!",
                CAST(COALESCE(di.id, db.id) as TEXT) as "document_version_id",
                d.owner as "user_id!",
                d.name as "name!",
                d."branchedFromId" as "branched_from_id",
                d."branchedFromVersionId" as "branched_from_version_id",
                d."documentFamilyId" as "document_family_id",
                d."fileType" as "file_type",
                d."createdAt"::timestamptz as "created_at!",
                d."updatedAt"::timestamptz as "updated_at!",
                d."projectId" as "project_id",
                NULL as "is_persistent",
                di.sha as "sha",
                dt.sub_type as "sub_type?: DocumentSubType",
                EXISTS (
                    SELECT 1
                    FROM document_email de
                    WHERE de.document_id = d.id
                ) as "is_email_attachment!",
                (
                    dt.sub_type IS DISTINCT FROM 'task'
                    OR EXISTS (
                        SELECT 1
                        FROM entity_properties ep_assignees
                        WHERE ep_assignees.entity_id = d.id
                            AND ep_assignees.entity_type = 'TASK'
                            AND ep_assignees.property_definition_id = $6
                            AND ep_assignees.values->'value' @> jsonb_build_array(
                                jsonb_build_object('entity_id', $1)
                            )
                    )
                ) as "is_important!",
                ARRAY(
                    SELECT status_option_id::uuid
                    FROM jsonb_array_elements_text(
                        CASE
                            WHEN jsonb_typeof(ep_status.values->'value') = 'array'
                            THEN ep_status.values->'value'
                            ELSE '[]'::jsonb
                        END
                    ) AS status_option_id
                ) as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                CASE
                    WHEN dt.sub_type = 'task'
                        AND ep_status.values->'value' ? $4
                    THEN true
                    WHEN dt.sub_type = 'task'
                    THEN false
                    ELSE NULL
                END as "is_completed",
                d."deletedAt"::timestamptz as "deleted_at"
            FROM "Document" d
            LEFT JOIN document_sub_type dt ON dt.document_id = d.id
            LEFT JOIN entity_properties ep_status 
                ON dt.sub_type = 'task'
                AND ep_status.entity_id = d.id 
                AND ep_status.entity_type = 'TASK'
                AND ep_status.property_definition_id = $5
            INNER JOIN UserAccessibleItems uai 
                ON uai.item_id = d.id 
                AND uai.item_type = 'document'
            LEFT JOIN "UserHistory" uh 
                ON uh."itemId" = d.id 
                AND uh."itemType" = 'document' 
                AND uh."userId" = $1
            LEFT JOIN LATERAL (
                SELECT b.id 
                FROM "DocumentBom" b 
                WHERE b."documentId" = d.id 
                ORDER BY b."createdAt" DESC 
                LIMIT 1
            ) db ON true
            LEFT JOIN LATERAL (
                SELECT i.id, i.sha 
                FROM "DocumentInstance" i 
                WHERE i."documentId" = d.id 
                ORDER BY i."updatedAt" DESC 
                LIMIT 1
            ) di ON true
            WHERE d."deletedAt" IS NULL
            AND d.id = ANY($2::text[])

            UNION ALL
        
            SELECT
                'chat' as "item_type!",
                c.id as "id!",
                NULL as "document_version_id",
                c."userId" as "user_id!",
                c.name as "name!",
                NULL as "branched_from_id",
                NULL as "branched_from_version_id",
                NULL as "document_family_id",
                NULL as "file_type",
                c."createdAt"::timestamptz as "created_at!",
                c."updatedAt"::timestamptz as "updated_at!",
                c."projectId" as "project_id",
                c."isPersistent" as "is_persistent",
                NULL as "sha",
                NULL as "sub_type",
                false as "is_email_attachment!",
                true as "is_important!",
                ARRAY[]::uuid[] as "status_option_ids!: Vec<Uuid>",
                uh."updatedAt"::timestamptz as "viewed_at",
                NULL as "is_completed",
                c."deletedAt"::timestamptz as "deleted_at"
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id
                AND uai.item_type = 'chat'
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = c.id
                AND uh."itemType" = 'chat'
                AND uh."userId" = $1
            WHERE c."deletedAt" IS NULL
            AND c.id = ANY($3::text[])
        )
        SELECT * 
        FROM Combined
        "#,
        user_id.as_ref(),        // $1
        document_ids.as_slice(), // $2
        chat_ids.as_slice(),     // $3
        completed_option_id,     // $4
        status_property_id,      // $5
        assignees_property_id,   // $6
    )
    .try_map(map_soup_projection_hydration!())
    .fetch_all(db)
    .await?;

    Ok(items)
}

/// Returns expanded authorized items by ID with optional document server facts.
#[tracing::instrument(err, skip(db, entities))]
pub async fn expanded_soup_by_ids_with_projection<'a>(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    entities: impl IntoIterator<Item = &'a Entity<'a>>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
    expanded_soup_by_ids_hydrated(db, user_id, entities).await
}

/// Returns expanded authorized items by ID without projection metadata.
#[cfg(test)]
#[tracing::instrument(err, skip(db, entities))]
pub async fn expanded_soup_by_ids<'a>(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    entities: impl IntoIterator<Item = &'a Entity<'a>>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    Ok(expanded_soup_by_ids_hydrated(db, user_id, entities)
        .await?
        .into_iter()
        .map(|hydration| hydration.item)
        .collect())
}
