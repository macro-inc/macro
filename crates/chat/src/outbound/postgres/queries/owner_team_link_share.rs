//! Read the link-share preference of an owner's team.

use model_owner::Owner;
use models_permissions::share_permission::{LinkShare, TeamLinkShareDefault};

/// Get the link-share preference of the team `owner` resolves to, or `None`
/// when the owner has no team.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn owner_team_link_share(
    pool: &sqlx::PgPool,
    owner: &Owner,
) -> anyhow::Result<Option<TeamLinkShareDefault>> {
    let row = sqlx::query!(
        r#"
        SELECT t.default_link_share AS "default_link_share?: LinkShare"
        FROM owner_team($1) ot
        JOIN team t ON t.id = ot.team_id
        LIMIT 1
        "#,
        owner.principal_id(),
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| TeamLinkShareDefault(row.default_link_share)))
}
