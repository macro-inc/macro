//! Teams for attention feeds. A team has no list of its own in Soup: it is a
//! candidate only through the notifications filed under it (a vault access
//! request to its managers), and it hydrates here by id.

#[cfg(test)]
mod test;

use model_entity::EntityType;
use models_soup::{item::SoupItem, team::SoupTeam};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::domain::models::AdvancedSortParams;
use crate::outbound::pg_soup_repo::candidate_gates::uuid_guarded;
use crate::outbound::pg_soup_repo::notified::ID_SQL;

/// The team `{team_id}` is visible to the viewer `$1` only while they are a
/// member: a former member's team notifications drop out of the inbox.
fn viewer_is_member(team_id: &str) -> String {
    format!(
        r#"EXISTS (
            SELECT 1 FROM team_user tu
            WHERE tu.team_id = {team_id} AND tu.user_id = $1
        )"#
    )
}

/// The attention gate: the candidate names a team the viewer belongs to.
pub(super) fn team_gate() -> String {
    uuid_guarded(ID_SQL, viewer_is_member(&format!("{ID_SQL}::uuid")))
}

pub(super) async fn by_ids(
    db: &PgPool,
    req: AdvancedSortParams<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let ids = req
        .entities
        .iter()
        .filter(|entity| entity.entity_type == EntityType::Team)
        .filter_map(|entity| entity.entity_id.parse::<Uuid>().ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // Shares its membership predicate with the attention gate, so it is built
    // at runtime like the candidate queries.
    let sql = format!(
        r#"SELECT t.id, t.name, t.owner_id FROM team t
            WHERE t.id = ANY($2) AND {member}"#,
        member = viewer_is_member("t.id"),
    );
    sqlx::QueryBuilder::<sqlx::Postgres>::new(sql)
        .build()
        .bind(req.user_id.as_ref())
        .bind(&ids)
        // Unnamed statement, as for the attention query it shares a gate with.
        .persistent(false)
        .try_map(|row: sqlx::postgres::PgRow| {
            Ok(SoupItem::Team(SoupTeam {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                owner_id: row.try_get("owner_id")?,
            }))
        })
        .fetch_all(db)
        .await
}
