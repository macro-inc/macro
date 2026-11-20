//! Grant checks for an agent session whose scope may not share
//! ([`agent_correlation::context::may_share`]).
//!
//! Such a session changes nobody's access to an item, by any route: every
//! helper in this crate that writes a grant refuses one that would add
//! access, and the helpers that revoke a user's, team's or channel's direct
//! grant refuse to remove one. The refusal is a `sqlx::Error::InvalidArgument`,
//! recorded with the request, so its boundary answers 403 whatever error its
//! caller made of it (`agent_correlation::inbound::answer_sharing_refusals`).

use crate::{AccessLevel, EntityAccessSourceType, EntityType};
use sqlx::PgConnection;

#[cfg(test)]
mod test;

/// A grant about to be written: who gets access to an entity, and how much.
#[derive(Clone, Copy, Debug)]
pub struct Grant<'a> {
    /// The user, team, channel or bot granted access.
    pub source_id: &'a str,
    /// What kind of grantee `source_id` is.
    pub source_type: EntityAccessSourceType,
    /// The level granted.
    pub access_level: AccessLevel,
}

/// A grant about to be written on one entity of several.
#[derive(Clone, Copy, Debug)]
pub struct EntityGrant<'a> {
    /// The entity the grant is written on.
    pub entity_id: macro_uuid::Uuid,
    /// The entity's `entity_access.entity_type`.
    pub entity_type: &'a str,
    /// The grant.
    pub grant: Grant<'a>,
}

/// Refuses a grant write that adds access (`adds_access`) under a scope that
/// may not share.
pub fn refuse_grant(adds_access: bool) -> Result<(), sqlx::Error> {
    agent_correlation::context::refuse_sharing(adds_access)
        .map_err(|refused| sqlx::Error::InvalidArgument(refused.to_string()))
}

/// Refuses writing `grants` on the entity under a scope that may not share
/// when one would let its grantee see the entity, or do more with it, than
/// the rows the grantee already holds on it allow. Queries only under such a
/// scope.
pub async fn refuse_added_access(
    connection: &mut PgConnection,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    grants: &[Grant<'_>],
) -> Result<(), sqlx::Error> {
    if agent_correlation::context::may_share() {
        return Ok(());
    }
    let entity_type = entity_type.as_ref();
    let grants: Vec<EntityGrant<'_>> = grants
        .iter()
        .map(|&grant| EntityGrant {
            entity_id: *entity_id,
            entity_type,
            grant,
        })
        .collect();
    refuse_added_access_across(connection, &grants).await
}

/// [`refuse_added_access`] for grants on several entities, in one query.
pub async fn refuse_added_access_across(
    connection: &mut PgConnection,
    grants: &[EntityGrant<'_>],
) -> Result<(), sqlx::Error> {
    if grants.is_empty() || agent_correlation::context::may_share() {
        return Ok(());
    }
    let mut entity_ids = Vec::new();
    let mut entity_types = Vec::new();
    let mut source_ids = Vec::new();
    let mut source_types = Vec::new();
    let mut levels = Vec::new();
    for EntityGrant {
        entity_id,
        entity_type,
        grant,
    } in grants
    {
        entity_ids.push(*entity_id);
        entity_types.push((*entity_type).to_owned());
        source_ids.push(grant.source_id.to_owned());
        source_types.push(source_type_name(grant.source_type).to_owned());
        levels.push(grant.access_level.to_string());
    }
    // A row from any source path counts: a grantee who reaches the entity
    // through a folder it is leaving keeps no access it didn't have.
    let adds_access = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
                AS grant_row(entity_id, entity_type, source_id, source_type, access_level)
            WHERE NOT EXISTS (
                SELECT 1 FROM entity_access held
                WHERE held.entity_id = grant_row.entity_id
                  AND held.entity_type = grant_row.entity_type
                  AND held.source_id = grant_row.source_id
                  AND held.source_type = grant_row.source_type::entity_access_source_type
                  AND held.access_level >= grant_row.access_level::"AccessLevel"
            )
        ) AS "adds_access!"
        "#,
        &entity_ids,
        &entity_types,
        &source_ids,
        &source_types,
        &levels,
    )
    .fetch_one(connection)
    .await?;
    refuse_grant(adds_access)
}

fn source_type_name(source_type: EntityAccessSourceType) -> &'static str {
    match source_type {
        EntityAccessSourceType::Channel => "channel",
        EntityAccessSourceType::Team => "team",
        EntityAccessSourceType::User => "user",
        EntityAccessSourceType::Bot => "bot",
    }
}
