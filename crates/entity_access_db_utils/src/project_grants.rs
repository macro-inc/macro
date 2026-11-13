//! Grants an entity inherits from the folders (projects) it is filed in.
//!
//! An entity in a folder holds one `entity_access` row per grant on that
//! folder or any folder above it, marked with `granted_from_project_id`.
//! Callers hold [`crate::team_share::acquire_guard`] in the same transaction.

use model_entity::EntityType;
use models_entity_access_management::EntityAccessSourceType;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{PgConnection, Postgres, QueryBuilder, Transaction};

use crate::scoped_grants::{EntityGrant, Grant, refuse_added_access_across, refuse_grant};
use crate::{get_nested_project_entities, walk_up_project_tree};

/// A grant made directly on a folder, which the folder's contents inherit.
#[derive(Clone, Debug)]
pub struct ProjectGrantSource {
    /// The folder the grant was made on.
    pub project_id: macro_uuid::Uuid,
    /// The user, channel or team granted access.
    pub source_id: String,
    /// What kind of grantee `source_id` is.
    pub source_type: EntityAccessSourceType,
    /// The level granted.
    pub access_level: AccessLevel,
}

/// The grants made directly on any of `project_ids`.
#[tracing::instrument(skip(transaction), err)]
pub async fn project_grant_sources(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[macro_uuid::Uuid],
) -> Result<Vec<ProjectGrantSource>, sqlx::Error> {
    sqlx::query!(
        r#"
        SELECT
        entity_id,
        source_id,
        source_type as "source_type:EntityAccessSourceType",
        access_level as "access_level:AccessLevel"
        FROM entity_access
        WHERE entity_id = ANY($1) AND entity_type = 'project' AND granted_from_project_id IS NULL
        "#,
        project_ids,
    )
    .map(|r| ProjectGrantSource {
        project_id: r.entity_id,
        source_id: r.source_id,
        source_type: r.source_type,
        access_level: r.access_level,
    })
    .fetch_all(transaction.as_mut())
    .await
}

/// Refuses, under a scope that may not share, giving each of `entities`
/// (id and `entity_access.entity_type`) `sources`' grants when one would add
/// access (see [`crate::scoped_grants`]).
pub async fn refuse_inherited_access(
    connection: &mut PgConnection,
    entities: &[(macro_uuid::Uuid, &str)],
    sources: &[ProjectGrantSource],
) -> Result<(), sqlx::Error> {
    if agent_correlation::context::may_share() {
        return Ok(());
    }
    let grants: Vec<EntityGrant<'_>> = entities
        .iter()
        .flat_map(|&(entity_id, entity_type)| {
            sources.iter().map(move |source| EntityGrant {
                entity_id,
                entity_type,
                grant: Grant {
                    source_id: &source.source_id,
                    source_type: source.source_type,
                    access_level: source.access_level,
                },
            })
        })
        .collect();
    refuse_added_access_across(connection, &grants).await
}

/// Refuses, under a scope that may not share, filing the entity in
/// `project_id` when the grants it would inherit from that folder and the
/// folders above it would add access; a folder brings its contents along. A
/// write that files an entity in a folder and inherits its grants in another
/// transaction calls this in the first, so a refused move or creation writes
/// nothing.
#[tracing::instrument(skip(transaction), err)]
pub async fn refuse_filing(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    project_id: &macro_uuid::Uuid,
) -> Result<(), sqlx::Error> {
    if agent_correlation::context::may_share() {
        return Ok(());
    }
    let project_ids = walk_up_project_tree(transaction, project_id).await?;
    let sources = project_grant_sources(transaction, &project_ids).await?;
    if sources.is_empty() {
        return Ok(());
    }
    let nested = if entity_type == EntityType::Project {
        get_nested_project_entities(transaction, entity_id).await?
    } else {
        Vec::new()
    };
    // Legacy contents without a UUID inherit through their folder at read time.
    let mut filed: Vec<(macro_uuid::Uuid, &str)> = nested
        .iter()
        .filter_map(|entity| {
            let id = macro_uuid::string_to_uuid(&entity.entity_id).ok()?;
            Some((id, entity.entity_type.as_str()))
        })
        .collect();
    if filed.is_empty() {
        filed.push((*entity_id, entity_type.as_ref()));
    }
    refuse_inherited_access(transaction.as_mut(), &filed, &sources).await
}

/// [`refuse_filing`] for a folder id as an entity row stores it: no folder, an
/// empty id (filed nowhere) or one that isn't a UUID has nothing to refuse.
pub async fn refuse_filing_in(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    project_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    match project_id.and_then(|id| macro_uuid::string_to_uuid(id).ok()) {
        Some(project_id) => refuse_filing(transaction, entity_id, entity_type, &project_id).await,
        None => Ok(()),
    }
}

/// [`refuse_filing`] for a document whose id isn't a UUID, moved by its
/// owner `owner` from folder `from` to folder `to` (folder ids as the document
/// row stores them). Such a document has no `entity_access` rows: at read time
/// it gives the grantees of its folder chain their grant and each folder's
/// owner edit. Under a scope that may not share, the move is refused when the
/// new chain reaches anyone but `owner` further than the old chain did.
///
/// A folder moved with such documents in it needs no call: the documents read
/// the folder's own grants, which [`refuse_filing`] checks.
#[tracing::instrument(skip(transaction), err)]
pub async fn refuse_unregistered_filing(
    transaction: &mut Transaction<'_, Postgres>,
    owner: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(), sqlx::Error> {
    let from = from.filter(|id| !id.is_empty());
    let Some(to) = to.filter(|id| !id.is_empty() && Some(*id) != from) else {
        return Ok(());
    };
    if agent_correlation::context::may_share() {
        return Ok(());
    }
    let reached = unregistered_reach(transaction, to).await?;
    let held = match from {
        Some(from) => unregistered_reach(transaction, from).await?,
        None => Vec::new(),
    };
    let adds_access = reached.iter().any(|(source_id, source_type, level)| {
        let is_owner = *source_type == EntityAccessSourceType::User && source_id == owner;
        !is_owner
            && !held.iter().any(|(held_id, held_type, held_level)| {
                held_id == source_id && held_type == source_type && held_level >= level
            })
    });
    refuse_grant(adds_access)
}

/// Who a document without `entity_access` rows filed in `project_id` reaches,
/// and how far: each grantee of the folder chain, and each folder's owner at
/// edit.
async fn unregistered_reach(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
) -> Result<Vec<(String, EntityAccessSourceType, AccessLevel)>, sqlx::Error> {
    let chain = sqlx::query!(
        r#"
        WITH RECURSIVE chain AS (
            SELECT id, "parentId", "userId" FROM "Project" WHERE id = $1
            UNION
            SELECT p.id, p."parentId", p."userId"
            FROM "Project" p
            JOIN chain c ON p.id = c."parentId"
        )
        SELECT id AS "id!", "userId" AS "user_id!" FROM chain
        "#,
        project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let project_ids: Vec<macro_uuid::Uuid> = chain
        .iter()
        .filter_map(|folder| macro_uuid::string_to_uuid(&folder.id).ok())
        .collect();
    let sources = project_grant_sources(transaction, &project_ids).await?;
    Ok(chain
        .into_iter()
        .map(|folder| {
            (
                folder.user_id,
                EntityAccessSourceType::User,
                AccessLevel::Edit,
            )
        })
        .chain(
            sources
                .into_iter()
                .map(|source| (source.source_id, source.source_type, source.access_level)),
        )
        .collect())
}

/// Give an entity just filed in `project_id` the grants of that folder and
/// every folder above it.
#[tracing::instrument(skip(transaction), err)]
pub async fn inherit_project_grants(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    project_id: &macro_uuid::Uuid,
) -> Result<(), sqlx::Error> {
    let project_ids = walk_up_project_tree(transaction, project_id).await?;
    let sources = project_grant_sources(transaction, &project_ids).await?;
    if sources.is_empty() {
        return Ok(());
    }
    refuse_inherited_access(
        transaction.as_mut(),
        &[(*entity_id, entity_type.as_ref())],
        &sources,
    )
    .await?;
    let entity_type: &str = entity_type.into();
    let mut query: QueryBuilder<Postgres> = QueryBuilder::new(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) ",
    );
    query.push_values(&sources, |mut row, source| {
        row.push_bind(entity_id)
            .push_bind(entity_type)
            .push_bind(&source.source_id)
            .push_bind(source.source_type)
            .push_bind(source.access_level)
            .push_bind(source.project_id.to_string());
    });
    query.push(" ON CONFLICT DO NOTHING");
    query.build().execute(transaction.as_mut()).await?;
    Ok(())
}

/// Drop the grants an entity inherited from `old_project_id` and every
/// folder above it, as it leaves that folder.
#[tracing::instrument(skip(transaction), err)]
pub async fn drop_project_grants(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    old_project_id: &macro_uuid::Uuid,
) -> Result<(), sqlx::Error> {
    let project_ids = walk_up_project_tree(transaction, old_project_id)
        .await?
        .into_iter()
        .map(|id| id.to_string())
        .collect::<Vec<String>>();
    if project_ids.is_empty() {
        return Ok(());
    }
    let entity_type: &str = entity_type.into();
    sqlx::query!(
        r#"
        DELETE FROM entity_access
        WHERE entity_id = $1
        AND entity_type = $2
        AND granted_from_project_id = ANY($3)
        "#,
        entity_id,
        entity_type,
        &project_ids,
    )
    .execute(transaction.as_mut())
    .await?;
    Ok(())
}
