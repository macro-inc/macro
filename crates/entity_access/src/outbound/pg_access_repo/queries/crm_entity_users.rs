//! Query for the users who can see a CRM company or contact.

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Members of the team that owns a CRM company or contact. Plain members lose
/// sight of a hidden record (a contact is hidden if it or its company is);
/// admins and owners keep it, matching per-user CRM access.
#[tracing::instrument(err, skip(pool))]
pub async fn get_crm_entity_users(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
) -> Result<Vec<MacroUserIdStr<'static>>, sqlx::Error> {
    let users = match entity_type {
        EntityType::CrmCompany => {
            sqlx::query_scalar!(
                r#"
                SELECT tu.user_id
                FROM crm_companies c
                JOIN team_user tu ON tu.team_id = c.team_id
                WHERE c.id = $1
                  AND (NOT c.hidden OR tu.team_role <> 'member')
                "#,
                entity_id
            )
            .fetch_all(pool)
            .await?
        }
        EntityType::CrmContact => {
            sqlx::query_scalar!(
                r#"
                SELECT tu.user_id
                FROM crm_contacts ct
                JOIN crm_companies c ON c.id = ct.company_id
                JOIN team_user tu ON tu.team_id = c.team_id
                WHERE ct.id = $1
                  AND (NOT (ct.hidden OR c.hidden) OR tu.team_role <> 'member')
                "#,
                entity_id
            )
            .fetch_all(pool)
            .await?
        }
        _ => vec![],
    };
    Ok(users
        .into_iter()
        .filter_map(|u| {
            MacroUserIdStr::parse_from_str(u.as_str())
                .ok()
                .map(|u| u.into_owned())
        })
        .collect())
}
