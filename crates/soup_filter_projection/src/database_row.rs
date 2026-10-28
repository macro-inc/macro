//! Direct database row fields for the browser-composed Soup profile.

use super::*;

#[cfg(test)]
mod test;

/// Failure to compose direct database row facts.
#[derive(Debug, Error)]
pub enum DatabaseRowProjectionError {
    /// Invalid direct projection data.
    #[error(transparent)]
    Direct(#[from] ProjectionError),
    /// Invalid bounded fact data.
    #[error(transparent)]
    Validation(#[from] ValidationError),
    /// Incomplete or noncanonical row facts.
    #[error(transparent)]
    Profile(#[from] ProfileValidationError),
}

/// Canonical row fields already exposed by GraphQL Soup.
#[derive(Debug, Clone)]
pub struct DatabaseRowProjectionInput {
    /// Normalized row record binding.
    pub record_key: RecordKey,
    /// Row UUID.
    pub id: uuid::Uuid,
    /// The database's owner.
    pub owner: String,
    /// The table the row belongs to.
    pub table_id: uuid::Uuid,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Project direct row metadata. The cache adapter additionally composes the
/// selected notification and property snapshots before establishing coverage.
pub fn project_database_row(
    input: DatabaseRowProjectionInput,
) -> Result<IndexDocument, DatabaseRowProjectionError> {
    let mut facts = common_exact_facts(input.id, input.owner)?;
    facts.push(uuid_fact(vocabulary::table_id(), input.table_id)?);
    let mut document = projection(
        input.record_key,
        vocabulary::profile_v4(),
        vocabulary::database_row_partition(),
        facts,
        input.created_at,
        input.updated_at,
    )?;
    document.canonicalize();
    validate_soup_flat_v4(&document)?;
    Ok(document)
}
