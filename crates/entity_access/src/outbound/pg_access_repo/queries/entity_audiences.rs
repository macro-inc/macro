//! Audiences of many entities of one type, resolved from their `entity_access` grants.

#[cfg(test)]
mod test;

use std::collections::{BTreeSet, HashMap};

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_entity_access_management::EntityAccessSourceType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::EntityAudience;

/// One source an `entity_access` grant names.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum GrantSource {
    User(String),
    Team(Uuid),
    Channel(Uuid),
}

/// Gets the users each entity's `entity_access` grants reach, as `get_entity_users`
/// does for one entity: direct users, team members, and active channel participants.
///
/// Reads the grants of every entity in one query, then the members of the distinct
/// teams and channels they name, so the cost follows the number of distinct sources
/// rather than entities times members. Entities granted to the same sources share
/// one audience. Entities without grants are left out.
#[tracing::instrument(
    skip(pool, entity_ids),
    fields(
        entity_count = entity_ids.len(),
        audience_count = tracing::field::Empty,
        team_count = tracing::field::Empty,
        channel_count = tracing::field::Empty,
    ),
    err
)]
pub async fn get_entity_audiences(
    pool: &PgPool,
    entity_ids: &[Uuid],
    entity_type: EntityType,
) -> Result<Vec<EntityAudience>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Member counts depend on the tenant's teams and channels; bound the lookup so a
    // slow one fails and is retried instead of holding a connection.
    sqlx::query!("SET LOCAL statement_timeout = '15s'")
        .execute(&mut *tx)
        .await?;

    let grants = sqlx::query!(
        r#"
        SELECT entity_id, source_type AS "source_type!: EntityAccessSourceType", source_id
        FROM entity_access
        WHERE entity_id = ANY($1) AND entity_type = $2
        "#,
        entity_ids,
        entity_type.as_ref(),
    )
    .fetch_all(&mut *tx)
    .await?;

    // Group entities by the exact set of sources their grants name. A team or
    // channel id that is not a UUID cannot match a member row, so it reaches no one.
    let mut sources_by_entity: HashMap<Uuid, BTreeSet<GrantSource>> = HashMap::new();
    for grant in grants {
        let source = match grant.source_type {
            EntityAccessSourceType::User => Some(GrantSource::User(grant.source_id)),
            EntityAccessSourceType::Team => Uuid::parse_str(&grant.source_id)
                .ok()
                .map(GrantSource::Team),
            EntityAccessSourceType::Channel => Uuid::parse_str(&grant.source_id)
                .ok()
                .map(GrantSource::Channel),
            EntityAccessSourceType::Bot => None,
        };
        let sources = sources_by_entity.entry(grant.entity_id).or_default();
        if let Some(source) = source {
            sources.insert(source);
        }
    }

    let mut entities_by_sources: HashMap<BTreeSet<GrantSource>, Vec<Uuid>> = HashMap::new();
    for (entity_id, sources) in sources_by_entity {
        entities_by_sources
            .entry(sources)
            .or_default()
            .push(entity_id);
    }

    let mut team_ids = BTreeSet::new();
    let mut channel_ids = BTreeSet::new();
    for source in entities_by_sources.keys().flatten() {
        match source {
            GrantSource::Team(team_id) => {
                team_ids.insert(*team_id);
            }
            GrantSource::Channel(channel_id) => {
                channel_ids.insert(*channel_id);
            }
            GrantSource::User(_) => {}
        }
    }
    let team_ids = team_ids.into_iter().collect::<Vec<_>>();
    let channel_ids = channel_ids.into_iter().collect::<Vec<_>>();

    let mut members: HashMap<GrantSource, Vec<String>> = HashMap::new();
    if !team_ids.is_empty() {
        let rows = sqlx::query!(
            "SELECT team_id, user_id FROM team_user WHERE team_id = ANY($1)",
            &team_ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        for row in rows {
            members
                .entry(GrantSource::Team(row.team_id))
                .or_default()
                .push(row.user_id);
        }
    }
    if !channel_ids.is_empty() {
        let rows = sqlx::query!(
            r#"
            SELECT channel_id, user_id
            FROM comms_channel_participants
            WHERE channel_id = ANY($1) AND left_at IS NULL
            "#,
            &channel_ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        for row in rows {
            members
                .entry(GrantSource::Channel(row.channel_id))
                .or_default()
                .push(row.user_id);
        }
    }
    tx.commit().await?;

    let span = tracing::Span::current();
    span.record("audience_count", entities_by_sources.len());
    span.record("team_count", team_ids.len());
    span.record("channel_count", channel_ids.len());

    Ok(entities_by_sources
        .into_iter()
        .map(|(sources, entity_ids)| {
            let users = sources
                .iter()
                .flat_map(|source| match source {
                    GrantSource::User(user_id) => std::slice::from_ref(user_id),
                    GrantSource::Team(_) | GrantSource::Channel(_) => {
                        members.get(source).map(Vec::as_slice).unwrap_or_default()
                    }
                })
                .collect::<BTreeSet<_>>()
                .into_iter()
                .filter_map(|user_id| {
                    MacroUserIdStr::parse_from_str(user_id)
                        .ok()
                        .map(CowLike::into_owned)
                })
                .collect();
            EntityAudience {
                entity_ids: entity_ids.iter().map(Uuid::to_string).collect(),
                users,
            }
        })
        .collect())
}
