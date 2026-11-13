//! SQL query functions for entity access checks.
//!
//! Each module contains a single query function for checking access to a specific entity type.

#[cfg(not(test))]
use cached::proc_macro::cached;

use anyhow::Context;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use sqlx::{Pool, Postgres};

#[cfg(feature = "explain_binary")]
use crate::domain::models::{AccessGrant, AccessLevel};
#[cfg(feature = "explain_binary")]
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
#[cfg(feature = "explain_binary")]
use models_entity_access_management::EntityAccessSourceType;

pub mod agent_session_access;
pub mod call_access;
pub mod call_channel;
pub mod channel_membership;
pub mod channel_role;
pub mod channel_users;
pub mod chat_access;
pub mod crm_company_access;
pub mod crm_contact_access;
pub mod crm_entity_users;
pub mod database_access;
pub mod database_row_access;
pub mod document_access;
pub mod foreign_entity_access;
pub mod form_access;
pub mod initiative_access;
pub mod pipeline_access;
pub mod project_access;
pub mod scheduled_action_access;
pub mod team_access;
pub mod thread_access;
mod viewer;

pub(crate) use viewer::{Viewer, team_bot_viewer};

#[cfg(test)]
mod source_list_oracle;
#[cfg(test)]
mod test;
#[cfg(test)]
pub(crate) mod test_viewers;
#[cfg(test)]
mod typed_owner_test;

/// Grabs all user IDs with access to an entity via the entity_access table.
#[tracing::instrument(skip(pool), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 10,
        result = true,
        key = "String",
        convert = r#"{format!("{}:{}", entity_type.as_ref(), entity_id)}"#
    )
)]
pub(in crate::outbound::pg_access_repo) async fn get_entity_users(
    pool: &Pool<Postgres>,
    entity_id: &uuid::Uuid,
    entity_type: EntityType,
) -> anyhow::Result<Vec<MacroUserIdStr<'static>>> {
    if entity_type == EntityType::ForeignEntity {
        return foreign_entity_access::get_foreign_entity_users(pool, entity_id).await;
    }
    // because we don't store entity_access per email we need to also grab the owner
    // of the email to append to the list, plus any primary that delegates the inbox
    // via macro_user_links (shared inbox)
    let mut email_owner: Vec<MacroUserIdStr> = if let EntityType::EmailThread = entity_type {
        let macro_ids = sqlx::query_scalar!(
            r#"
        SELECT l.macro_id AS "macro_id!"
        FROM email_threads et
        JOIN email_links l ON et.link_id = l.id
        WHERE et.id = $1
        UNION
        SELECT mul.primary_macro_id
        FROM email_threads et
        JOIN email_links l ON et.link_id = l.id
        JOIN macro_user_links mul ON mul.link_id = l.id
        WHERE et.id = $1
        "#,
            entity_id
        )
        .fetch_all(pool)
        .await?;

        macro_ids
            .into_iter()
            .map(|macro_id| {
                MacroUserIdStr::parse_from_str(macro_id.as_str())
                    .map(|u| u.into_owned())
                    .context("macro user id should be valid")
            })
            .collect::<anyhow::Result<Vec<_>>>()?
    } else {
        vec![]
    };

    let mut users: Vec<MacroUserIdStr<'static>> = sqlx::query_scalar!(
        r#"
    SELECT user_id FROM (
        -- Direct user grants
        SELECT source_id as user_id FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'user'

        UNION ALL

        -- Channel Members
        SELECT cp.user_id FROM comms_channel_participants cp
        WHERE cp.left_at IS NULL AND cp.channel_id IN (
            SELECT source_id::uuid FROM entity_access
            WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'channel'
        )

        UNION ALL

        -- Team Members
        SELECT tu.user_id FROM team_user tu
        WHERE tu.team_id IN (
            SELECT source_id::uuid FROM entity_access
            WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'team'
        )
    ) AS combined_users

    "#,
        entity_id,
        entity_type.as_ref(),
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter_map(|u| {
        u.and_then(|u| {
            MacroUserIdStr::parse_from_str(u.as_str())
                .ok()
                .map(|u| u.into_owned())
        })
    })
    .collect::<Vec<MacroUserIdStr<'static>>>();

    // add in email owner (if applicable)
    users.append(&mut email_owner);

    Ok(users
        .into_iter()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect())
}

#[cfg(feature = "explain_binary")]
#[tracing::instrument(skip(pool, user_id), err)]
pub async fn list_entity_access_grants(
    pool: &Pool<Postgres>,
    entity_id: &uuid::Uuid,
    entity_type: EntityType,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            source_type AS "source_type!: EntityAccessSourceType",
            source_id,
            access_level AS "access_level!: AccessLevel",
            granted_from_project_id
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = $2
          AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $3, NULL))
        "#,
        entity_id,
        entity_type.as_ref(),
        user_id.as_ref(),
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AccessGrant::EntityAccess {
            source_type: row.source_type,
            source_id: row.source_id,
            access_level: row.access_level,
            granted_from_project_id: row.granted_from_project_id,
        })
        .collect())
}

pub mod external_chat_access;
