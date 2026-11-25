//! CRM lists follow merged companies to the one that stays, inside the
//! merging domain's transaction.

#[cfg(test)]
mod test;

use sqlx::PgConnection;
use uuid::Uuid;

/// A CRM list's configuration before a merge changed it.
#[derive(Debug, Clone, PartialEq)]
pub struct MergedListView {
    /// The saved view.
    pub view_id: Uuid,
    /// Its configuration before the merge.
    pub previous_config: serde_json::Value,
    /// Its revision before the merge.
    pub previous_revision: i64,
}

/// In the CRM lists of `members` for `team_id`, replace every company in
/// `sources` with `survivor`, keeping each list's order and listing the
/// survivor once. Each view is locked as its own writers lock it, in id order.
/// Returns the lists changed, as they were.
#[tracing::instrument(name = "saved_views.merge_crm_lists", skip_all, fields(%team_id, members = members.len(), changed = tracing::field::Empty), err)]
pub async fn retarget_crm_list_companies_in(
    conn: &mut PgConnection,
    team_id: Uuid,
    members: &[String],
    sources: &[Uuid],
    survivor: Uuid,
) -> Result<Vec<MergedListView>, sqlx::Error> {
    let sources: Vec<String> = sources.iter().map(Uuid::to_string).collect();
    // Start from each member's views (`idx_views_user_id`); the config has no
    // index, so it is only filtered on those rows.
    let ids = sqlx::query_scalar!(
        r#"SELECT v.id
           FROM (SELECT id, config FROM saved_view WHERE user_id = ANY($1) OFFSET 0) v
           WHERE v.config->>'kind' = 'crm-list'
             AND v.config->>'teamId' = $2::uuid::text
             AND jsonb_typeof(v.config->'companyIds') = 'array'
             AND v.config->'companyIds' ?| $3
           ORDER BY v.id"#,
        members,
        team_id,
        &sources,
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut changed = Vec::with_capacity(ids.len());
    for id in ids {
        let key = format!("saved-view:{id}");
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(&mut *conn)
            .await?;
        let previous = sqlx::query!(
            r#"WITH previous AS MATERIALIZED (
                   SELECT id, config, revision FROM saved_view
                   WHERE id = $1 AND jsonb_typeof(config->'companyIds') = 'array'
                     AND config->'companyIds' ?| $2
                   FOR UPDATE
               ), rewritten AS (
                   SELECT p.id, COALESCE((
                       SELECT jsonb_agg(company ORDER BY first_seen)
                       FROM (
                           SELECT CASE WHEN element = ANY($2) THEN $3::uuid::text ELSE element END AS company,
                                  MIN(position) AS first_seen
                           FROM jsonb_array_elements_text(p.config->'companyIds') WITH ORDINALITY AS e(element, position)
                           GROUP BY 1
                       ) companies
                   ), '[]'::jsonb) AS company_ids
                   FROM previous p
               ), updated AS (
                   UPDATE saved_view v
                   SET config = jsonb_set(v.config, '{companyIds}', r.company_ids),
                       revision = v.revision + 1, updated_at = NOW()
                   FROM rewritten r WHERE v.id = r.id
               )
               SELECT config AS "config!", revision AS "revision!" FROM previous"#,
            id,
            &sources,
            survivor,
        )
        .fetch_optional(&mut *conn)
        .await?;
        if let Some(previous) = previous {
            changed.push(MergedListView {
                view_id: id,
                previous_config: previous.config,
                previous_revision: previous.revision,
            });
        }
    }
    tracing::Span::current().record("changed", changed.len());
    Ok(changed)
}
