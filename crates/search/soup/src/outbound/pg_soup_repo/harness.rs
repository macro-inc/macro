//! Paired runtimes (harnesses) for attention feeds. A runtime has no list of
//! its own in Soup: it is a candidate only through the notifications filed
//! under it (access requests, grants and removals), and it hydrates here by
//! id.

#[cfg(test)]
mod test;

use entity_kind::EntityType;
use model_owner::Owner;
use soup_types::{harness::SoupHarness, item::SoupItem};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::domain::models::AdvancedSortParams;
use crate::outbound::pg_soup_repo::candidate_gates::uuid_guarded;
use crate::outbound::pg_soup_repo::notified::ID_SQL;

/// The `harnesses` row aliased `alias` is visible to the viewer `$1`: they
/// own it, or share a team with it or its owner. A runtime is only ever
/// shared among its owner's teammates, so this covers its owner, everyone
/// who asked for it and everyone whose access to it was removed. A Macro
/// computer's harness belongs to its team, so `harness_access_level` decides
/// instead, never its recorded owner.
fn visible_harness(alias: &str) -> String {
    format!(
        r#"{alias}.deleted_at IS NULL
            AND ({alias}.computer_id IS NULL OR harness_access_level({alias}.id, $1) IS NOT NULL)
            AND ({alias}.computer_id IS NOT NULL OR {alias}.owner_user_id = $1 OR EXISTS (
                SELECT 1 FROM team_user viewer_team
                WHERE viewer_team.user_id = $1
                AND (viewer_team.team_id = {alias}.team_id OR EXISTS (
                    SELECT 1 FROM team_user owner_team
                    WHERE owner_team.team_id = viewer_team.team_id
                    AND owner_team.user_id = {alias}.owner_user_id
                ))
            ))"#
    )
}

/// The attention gate: the candidate names a runtime the viewer can see.
pub(super) fn harness_gate() -> String {
    uuid_guarded(
        ID_SQL,
        format!(
            r#"EXISTS (
                SELECT 1 FROM harnesses h
                WHERE h.id = {ID_SQL}::uuid
                AND {visible}
            )"#,
            visible = visible_harness("h"),
        ),
    )
}

pub(super) async fn by_ids(
    db: &PgPool,
    req: AdvancedSortParams<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let ids = req
        .entities
        .iter()
        .filter(|entity| entity.entity_type == EntityType::Harness)
        .filter_map(|entity| entity.entity_id.parse::<Uuid>().ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // Shares its visibility predicate with the attention gate, so it is
    // built at runtime like the candidate queries.
    let sql = format!(
        r#"SELECT h.id, h.name, h.owner_user_id, h.team_id, h.created_at, h.updated_at
            FROM harnesses h
            WHERE h.id = ANY($2) AND {visible}"#,
        visible = visible_harness("h"),
    );
    sqlx::QueryBuilder::<sqlx::Postgres>::new(sql)
        .build()
        .bind(req.user_id.as_ref())
        .bind(&ids)
        // Unnamed statement, as for the attention query it shares a gate with.
        .persistent(false)
        .try_map(|row: sqlx::postgres::PgRow| {
            let owner_user_id: Option<String> = row.try_get("owner_user_id")?;
            let team_id: Option<Uuid> = row.try_get("team_id")?;
            let owner = match (owner_user_id, team_id) {
                (Some(user), None) => Owner::from_principal_str(&user).map_err(super::type_err)?,
                (None, Some(team)) => Owner::Team(team),
                _ => {
                    return Err(super::type_err(
                        "a harness has exactly one of owner_user_id and team_id",
                    ));
                }
            };
            Ok(SoupItem::Harness(SoupHarness {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                owner_id: owner,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            }))
        })
        .fetch_all(db)
        .await
}
