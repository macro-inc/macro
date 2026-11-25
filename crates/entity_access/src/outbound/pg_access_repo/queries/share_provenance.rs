//! Batched viewer-relative share provenance resolution from `entity_access`.

use std::collections::{HashMap, HashSet};

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_entity::EntityType;
use models_entity_access_management::EntityAccessSourceType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{EntityShareProvenance, ShareProvenanceKind};

#[derive(Debug, Clone)]
struct ChannelMeta {
    is_dm: bool,
    name: Option<String>,
}

/// Priority rank: lower wins (`Direct` > `Dm` > `Channel` > `Team`).
fn provenance_rank(kind: ShareProvenanceKind) -> u8 {
    match kind {
        ShareProvenanceKind::Direct => 0,
        ShareProvenanceKind::Dm => 1,
        ShareProvenanceKind::Channel => 2,
        ShareProvenanceKind::Team => 3,
    }
}

/// Resolves viewer-relative share provenance for a bounded batch of entities.
///
/// Runs inside a single read-only repeatable-read transaction under a 5s
/// `statement_timeout`:
/// 1. Reads the viewer's active channels (with `channel_type` and `name`) and
///    teams (with `name`) to partition their `entity_access` sources.
/// 2. Joins the bounded `(entity_id, entity_type)` batch against
///    `entity_access` filtered to the viewer's own sources so no unjoined
///    channels or teams are ever exposed.
#[tracing::instrument(
    err,
    skip(pool, user_id, entities),
    fields(entity_count = entities.len())
)]
pub async fn get_entities_share_provenance(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
    entities: &[(Uuid, EntityType)],
) -> Result<Vec<EntityShareProvenance>, sqlx::Error> {
    if entities.is_empty() {
        return Ok(Vec::new());
    }

    let viewer_id = user_id.as_ref();
    let mut tx = pool
        .begin_with("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;

    let channel_rows = sqlx::query!(
        r#"
        SELECT c.id,
               (c.channel_type = 'direct_message') AS "is_dm!",
               c.name
        FROM comms_channel_participants cp
        JOIN comms_channels c ON c.id = cp.channel_id
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
        "#,
        viewer_id,
    )
    .fetch_all(&mut *tx)
    .await?;

    let team_rows = sqlx::query!(
        r#"
        SELECT t.id, t.name
        FROM team_user tu
        JOIN team t ON t.id = tu.team_id
        WHERE tu.user_id = $1
        "#,
        viewer_id,
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut channels: HashMap<Uuid, ChannelMeta> = HashMap::with_capacity(channel_rows.len());
    let mut teams: HashMap<Uuid, String> = HashMap::with_capacity(team_rows.len());
    let mut source_ids: Vec<String> = Vec::with_capacity(1 + channel_rows.len() + team_rows.len());
    source_ids.push(viewer_id.to_string());

    for row in channel_rows {
        source_ids.push(row.id.to_string());
        channels.insert(
            row.id,
            ChannelMeta {
                is_dm: row.is_dm,
                name: row.name,
            },
        );
    }
    for row in team_rows {
        source_ids.push(row.id.to_string());
        teams.insert(row.id, row.name);
    }

    let mut entity_ids: Vec<Uuid> = Vec::with_capacity(entities.len());
    let mut entity_types: Vec<String> = Vec::with_capacity(entities.len());
    let mut seen: HashSet<(Uuid, EntityType)> = HashSet::with_capacity(entities.len());
    for &(id, entity_type) in entities {
        if seen.insert((id, entity_type)) {
            entity_ids.push(id);
            entity_types.push(entity_type.as_ref().to_string());
        }
    }

    let grants = sqlx::query!(
        r#"
        SELECT ea.entity_id,
               ea.entity_type,
               ea.source_id,
               ea.source_type AS "source_type!: EntityAccessSourceType"
        FROM unnest($1::uuid[], $2::text[]) AS req(entity_id, entity_type)
        JOIN entity_access ea
          ON ea.entity_id = req.entity_id
         AND ea.entity_type = req.entity_type
        WHERE ea.source_id = ANY($3)
        "#,
        &entity_ids,
        &entity_types,
        &source_ids,
    )
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;

    let type_by_str: HashMap<&str, EntityType> =
        entities.iter().map(|(_, ty)| (ty.as_ref(), *ty)).collect();

    let mut best: HashMap<(Uuid, EntityType), EntityShareProvenance> = HashMap::new();
    for grant in grants {
        let Some(&entity_type) = type_by_str.get(grant.entity_type.as_str()) else {
            continue;
        };
        let candidate = match grant.source_type {
            EntityAccessSourceType::User if grant.source_id == viewer_id => EntityShareProvenance {
                entity_id: grant.entity_id,
                entity_type,
                kind: ShareProvenanceKind::Direct,
                channel_id: None,
                channel_name: None,
                team_id: None,
                team_name: None,
            },
            EntityAccessSourceType::Channel => {
                let Ok(channel_id) = Uuid::parse_str(&grant.source_id) else {
                    continue;
                };
                let Some(meta) = channels.get(&channel_id) else {
                    continue;
                };
                if meta.is_dm {
                    EntityShareProvenance {
                        entity_id: grant.entity_id,
                        entity_type,
                        kind: ShareProvenanceKind::Dm,
                        channel_id: Some(channel_id),
                        channel_name: None,
                        team_id: None,
                        team_name: None,
                    }
                } else {
                    EntityShareProvenance {
                        entity_id: grant.entity_id,
                        entity_type,
                        kind: ShareProvenanceKind::Channel,
                        channel_id: Some(channel_id),
                        channel_name: meta.name.clone(),
                        team_id: None,
                        team_name: None,
                    }
                }
            }
            EntityAccessSourceType::Team => {
                let Ok(team_id) = Uuid::parse_str(&grant.source_id) else {
                    continue;
                };
                let Some(team_name) = teams.get(&team_id) else {
                    continue;
                };
                EntityShareProvenance {
                    entity_id: grant.entity_id,
                    entity_type,
                    kind: ShareProvenanceKind::Team,
                    channel_id: None,
                    channel_name: None,
                    team_id: Some(team_id),
                    team_name: Some(team_name.clone()),
                }
            }
            EntityAccessSourceType::User | EntityAccessSourceType::Bot => continue,
        };

        let key = (grant.entity_id, entity_type);
        match best.get(&key) {
            Some(existing) if !should_replace(existing, &candidate) => {}
            _ => {
                best.insert(key, candidate);
            }
        }
    }

    // Preserve the caller's input order deterministically.
    let mut results = Vec::with_capacity(best.len());
    let mut emitted = HashSet::with_capacity(best.len());
    for &(id, entity_type) in entities {
        if emitted.insert((id, entity_type))
            && let Some(entry) = best.remove(&(id, entity_type))
        {
            results.push(entry);
        }
    }
    Ok(results)
}

fn should_replace(existing: &EntityShareProvenance, candidate: &EntityShareProvenance) -> bool {
    let existing_rank = provenance_rank(existing.kind);
    let candidate_rank = provenance_rank(candidate.kind);
    if candidate_rank != existing_rank {
        return candidate_rank < existing_rank;
    }
    // Deterministic tie-breaker within the same provenance kind: prefer named
    // channels/teams, then lexicographical name, then lowest UUID.
    let existing_tie = (
        existing.channel_name.is_none() && existing.team_name.is_none(),
        existing
            .channel_name
            .as_deref()
            .or(existing.team_name.as_deref())
            .unwrap_or(""),
        existing.channel_id.or(existing.team_id),
    );
    let candidate_tie = (
        candidate.channel_name.is_none() && candidate.team_name.is_none(),
        candidate
            .channel_name
            .as_deref()
            .or(candidate.team_name.as_deref())
            .unwrap_or(""),
        candidate.channel_id.or(candidate.team_id),
    );
    candidate_tie < existing_tie
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::{AccessError, MAX_SHARE_PROVENANCE_ENTITIES};
    use crate::domain::ports::EntityShareProvenanceLookup;
    use crate::domain::service::EntityAccessServiceImpl;
    use crate::outbound::pg_access_repo::PgAccessRepository;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use macro_user_id::user_id::MacroUserIdStr;

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn resolves_share_provenance_priority_and_scopes_to_viewer_memberships(
        pool: PgPool,
    ) -> anyhow::Result<()> {
        sqlx::raw_sql(
            r#"
            INSERT INTO public."Organization" ("id", "name", "status")
            VALUES (1, 'Provenance Org', 'PILOT');

            INSERT INTO public.macro_user ("id", "username", "email", "stripe_customer_id")
            VALUES ('a1111111-1111-1111-1111-111111111111', 'alice@example.com', 'alice@example.com', 's1'),
                   ('a2222222-2222-2222-2222-222222222222', 'bob@example.com', 'bob@example.com', 's2'),
                   ('a3333333-3333-3333-3333-333333333333', 'carol@example.com', 'carol@example.com', 's3');

            INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
            VALUES ('macro|alice@example.com', 'alice@example.com', 's1', 1, 'a1111111-1111-1111-1111-111111111111'),
                   ('macro|bob@example.com', 'bob@example.com', 's2', 1, 'a2222222-2222-2222-2222-222222222222'),
                   ('macro|carol@example.com', 'carol@example.com', 's3', 1, 'a3333333-3333-3333-3333-333333333333');

            INSERT INTO public.team ("id", "name", "owner_id")
            VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Acme Core', 'macro|bob@example.com'),
                   ('eeeeeeee-0000-4000-8000-000000000002', 'Secret Team', 'macro|carol@example.com');

            INSERT INTO public.team_user ("user_id", "team_id", "team_role")
            VALUES ('macro|alice@example.com', 'eeeeeeee-0000-4000-8000-000000000001', 'member'),
                   ('macro|carol@example.com', 'eeeeeeee-0000-4000-8000-000000000002', 'owner');

            INSERT INTO public.comms_channels ("id", "channel_type", "name", "owner_id")
            VALUES ('cccccccc-0000-4000-8000-000000000001', 'direct_message', NULL, 'macro|bob@example.com'),
                   ('cccccccc-0000-4000-8000-000000000002', 'public', 'beta-room', 'macro|bob@example.com'),
                   ('cccccccc-0000-4000-8000-000000000003', 'private', 'alpha-room', 'macro|bob@example.com'),
                   ('cccccccc-0000-4000-8000-000000000004', 'private', 'left-room', 'macro|bob@example.com');

            INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "left_at")
            VALUES ('cccccccc-0000-4000-8000-000000000001', 'member', 'macro|alice@example.com', NULL),
                   ('cccccccc-0000-4000-8000-000000000002', 'member', 'macro|alice@example.com', NULL),
                   ('cccccccc-0000-4000-8000-000000000003', 'member', 'macro|alice@example.com', NULL),
                   ('cccccccc-0000-4000-8000-000000000004', 'member', 'macro|alice@example.com', '2024-01-10 00:00:00+00');

            INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
            VALUES ('11111111-0000-4000-8000-000000000001', 'document', 'macro|alice@example.com', 'user', 'view'),
                   ('11111111-0000-4000-8000-000000000001', 'document', 'eeeeeeee-0000-4000-8000-000000000001', 'team', 'view'),
                   ('11111111-0000-4000-8000-000000000002', 'document', 'cccccccc-0000-4000-8000-000000000001', 'channel', 'view'),
                   ('11111111-0000-4000-8000-000000000002', 'document', 'cccccccc-0000-4000-8000-000000000003', 'channel', 'view'),
                   ('11111111-0000-4000-8000-000000000003', 'project', 'cccccccc-0000-4000-8000-000000000002', 'channel', 'view'),
                   ('11111111-0000-4000-8000-000000000003', 'project', 'cccccccc-0000-4000-8000-000000000003', 'channel', 'view'),
                   ('11111111-0000-4000-8000-000000000004', 'database', 'eeeeeeee-0000-4000-8000-000000000001', 'team', 'view'),
                   ('11111111-0000-4000-8000-000000000005', 'document', 'cccccccc-0000-4000-8000-000000000004', 'channel', 'view'),
                   ('11111111-0000-4000-8000-000000000006', 'document', 'eeeeeeee-0000-4000-8000-000000000002', 'team', 'view');
            "#,
        )
        .execute(&pool)
        .await?;

        let alice = MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap();
        let id = |n: u32| Uuid::parse_str(&format!("11111111-0000-4000-8000-{n:012}")).unwrap();

        let service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
        let results = service
            .get_entities_share_provenance(
                &alice.0,
                &[
                    (id(1), EntityType::Document),
                    (id(2), EntityType::Document),
                    (id(3), EntityType::Project),
                    (id(4), EntityType::Database),
                    (id(5), EntityType::Document),
                    (id(6), EntityType::Document),
                ],
            )
            .await?;

        assert_eq!(results.len(), 4);
        assert_eq!(results[0].entity_id, id(1));
        assert_eq!(results[0].kind, ShareProvenanceKind::Direct);

        assert_eq!(results[1].entity_id, id(2));
        assert_eq!(results[1].kind, ShareProvenanceKind::Dm);
        assert_eq!(
            results[1].channel_id,
            Some(Uuid::parse_str("cccccccc-0000-4000-8000-000000000001").unwrap())
        );

        assert_eq!(results[2].entity_id, id(3));
        assert_eq!(results[2].entity_type, EntityType::Project);
        assert_eq!(results[2].kind, ShareProvenanceKind::Channel);
        assert_eq!(results[2].channel_name.as_deref(), Some("alpha-room"));

        assert_eq!(results[3].entity_id, id(4));
        assert_eq!(results[3].entity_type, EntityType::Database);
        assert_eq!(results[3].kind, ShareProvenanceKind::Team);
        assert_eq!(results[3].team_name.as_deref(), Some("Acme Core"));

        let oversized: Vec<(Uuid, EntityType)> = (0..=MAX_SHARE_PROVENANCE_ENTITIES)
            .map(|_| (Uuid::new_v4(), EntityType::Document))
            .collect();
        let err = service
            .get_entities_share_provenance(&alice.0, &oversized)
            .await
            .expect_err("batch over limit must fail");
        assert!(matches!(err, AccessError::BadRequest(_)));

        Ok(())
    }
}
