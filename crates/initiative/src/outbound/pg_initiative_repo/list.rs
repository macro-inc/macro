use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use super::{AdapterError, map_sqlx, parse_description_document_id};
use crate::domain::models::{InitiativeError, InitiativeId, InitiativeList, InitiativeSummary};

pub(super) async fn list_accessible(
    pool: &PgPool,
    user_id: &MacroUserIdStr<'static>,
) -> Result<InitiativeList, InitiativeError> {
    let rows = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text AS source_id
            FROM comms_channel_participants cp
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text
            FROM team_user t
            WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        )
        SELECT
            i.id,
            i.name,
            i.description_document_id,
            i.updated_at
        FROM initiative i
        JOIN "SharePermission" sp ON sp.id = i.share_permission_id
        WHERE EXISTS (
            SELECT 1
            FROM entity_access ea
            WHERE ea.entity_id = i.id
              AND ea.entity_type = 'initiative'
              AND ea.source_id IN (SELECT source_id FROM user_source_ids)
        )
        OR (
            sp."linkShare" = 'TEAM'
            AND EXISTS (
                SELECT 1
                FROM team_user owner_tu
                WHERE owner_tu.user_id = i.owner_user_id
                  AND owner_tu.team_id::text IN (SELECT source_id FROM user_source_ids)
            )
        )
        ORDER BY i.updated_at DESC
        "#,
        user_id.as_ref(),
    )
    .fetch_all(pool)
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    let initiatives = rows
        .into_iter()
        .map(|row| {
            Ok(InitiativeSummary {
                id: InitiativeId::from_uuid(row.id),
                name: row.name,
                description_document_id: parse_description_document_id(
                    row.id,
                    &row.description_document_id,
                )?,
                updated_at: row.updated_at,
            })
        })
        .collect::<Result<Vec<_>, InitiativeError>>()?;

    Ok(InitiativeList { initiatives })
}
