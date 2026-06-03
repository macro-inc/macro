//! SQL query functions for entity access checks.
//!
//! Each module contains a single query function for checking access to a specific entity type.

#[cfg(not(test))]
use cached::proc_macro::cached;

use anyhow::Context;

use macro_user_id::{
    cowlike::CowLike,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_entity::EntityType;
use sqlx::{Pool, Postgres};

pub mod call_access;
pub mod call_channel;
pub mod channel_membership;
pub mod channel_role;
pub mod channel_users;
pub mod chat_access;
pub mod crm_company_access;
pub mod crm_contact_access;
pub mod document_access;
pub mod foreign_entity_access;
pub mod project_access;
pub mod team_access;
pub mod thread_access;

#[cfg(test)]
mod test;

/// Type safety for source ids for entity_access table
#[derive(Debug, Clone)]
pub(in crate::outbound::pg_access_repo) struct SourceIds(pub Vec<String>);

/// Grabs the users source ids for the entity access table
/// NOTE: This could return an empty list in the event the user is not logged in and attempting to review a resource
#[tracing::instrument(skip(pool), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{format!("{}", user_id.map(AsRef::as_ref).unwrap_or(""))}"#,
    )
)]
pub(in crate::outbound::pg_access_repo) async fn get_user_source_ids(
    pool: &Pool<Postgres>,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> anyhow::Result<SourceIds> {
    if let Some(user_id) = user_id {
        // Fetch source IDs first
        let source_ids = sqlx::query_scalar!(
            r#"
            SELECT cp.channel_id::text FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
            "#,
            user_id.as_ref()
        )
        .fetch_all(pool)
        .await?;

        let source_ids: Vec<String> = source_ids.into_iter().flatten().collect();

        Ok(SourceIds(source_ids))
    } else {
        Ok(SourceIds(vec![]))
    }
}

/// Grabs all user IDs with access to an entity via the entity_access table.
#[tracing::instrument(skip(pool), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
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
        JOIN macro_user_links mul ON mul.child_macro_id = l.macro_id
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
