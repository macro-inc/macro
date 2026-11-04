//! An entity's grants as sources, and the users a set of sources reaches.
//!
//! A permanent delete records its entity's grants before removing them, so a
//! consumer can still reach the people who had access. Neither query is cached:
//! the grants are read once, right before they go.

#[cfg(test)]
mod test;

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_entity_access_management::{EntityAccessSource, EntityAccessSourceType};
use sqlx::PgPool;
use uuid::Uuid;

/// The user, channel and team grants on an entity. Bot grants are left out, as
/// in the entity's user audience.
#[tracing::instrument(err, skip(pool))]
pub async fn get_entity_access_sources(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
) -> Result<Vec<EntityAccessSource>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT
            source_type AS "source_type!: EntityAccessSourceType",
            source_id
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = $2
          AND source_type IN ('user', 'channel', 'team')
        "#,
        entity_id,
        entity_type.as_ref(),
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| EntityAccessSource {
            source_type: row.source_type,
            source_id: row.source_id,
        })
        .collect())
}

/// Users the sources reach now: user grants themselves, active participants of
/// channel grants, and members of team grants.
#[tracing::instrument(err, skip(pool, sources), fields(source_count = sources.len()))]
pub async fn get_users_for_sources(
    pool: &PgPool,
    sources: &[EntityAccessSource],
) -> Result<Vec<MacroUserIdStr<'static>>, sqlx::Error> {
    let mut user_ids = Vec::new();
    let mut channel_ids = Vec::new();
    let mut team_ids = Vec::new();
    for source in sources {
        match source.source_type {
            EntityAccessSourceType::User => user_ids.push(source.source_id.clone()),
            EntityAccessSourceType::Channel => {
                channel_ids.extend(Uuid::parse_str(&source.source_id))
            }
            EntityAccessSourceType::Team => team_ids.extend(Uuid::parse_str(&source.source_id)),
            EntityAccessSourceType::Bot => {}
        }
    }

    let users = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT reached.user_id AS "user_id!"
        FROM (
            SELECT unnest($1::text[]) AS user_id

            UNION ALL

            SELECT cp.user_id
            FROM comms_channel_participants cp
            WHERE cp.left_at IS NULL AND cp.channel_id = ANY($2::uuid[])

            UNION ALL

            SELECT tu.user_id
            FROM team_user tu
            WHERE tu.team_id = ANY($3::uuid[])
        ) AS reached
        "#,
        &user_ids,
        &channel_ids,
        &team_ids,
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter_map(|user| {
        MacroUserIdStr::parse_from_str(user.as_str())
            .ok()
            .map(|user| user.into_owned())
    })
    .collect();

    Ok(users)
}
