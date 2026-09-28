//! Direct channel fields for the general Soup projection profile.

use super::*;

/// Failure to compose direct channel facts.
#[derive(Debug, Error)]
pub enum ChannelProjectionError {
    /// Invalid direct projection data.
    #[error(transparent)]
    Direct(#[from] ProjectionError),
    /// Invalid bounded fact data.
    #[error(transparent)]
    Validation(#[from] ValidationError),
    /// Incomplete or noncanonical channel facts.
    #[error(transparent)]
    Profile(#[from] ProfileValidationError),
}

/// Canonical channel fields already exposed by GraphQL Soup.
#[derive(Debug, Clone)]
pub struct ChannelProjectionInput {
    /// Normalized channel record binding.
    pub record_key: RecordKey,
    /// Channel UUID.
    pub id: uuid::Uuid,
    /// Channel owner.
    pub owner: String,
    /// Canonical public/private/direct_message/team type.
    pub channel_type: String,
    /// Optional team UUID.
    pub team_id: Option<uuid::Uuid>,
    /// Optional organization ID.
    pub organization_id: Option<i64>,
    /// Authoritative viewer-relative active participation.
    pub is_participant: bool,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Content update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Project direct channel metadata. The cache adapter must additionally compose
/// a complete selected active-notification snapshot before establishing coverage.
pub fn project_channel(
    input: ChannelProjectionInput,
) -> Result<IndexDocument, ChannelProjectionError> {
    let mut facts = common_exact_facts(input.id, input.owner)?;
    facts.push(utf8_fact(vocabulary::channel_type(), input.channel_type)?);
    facts.push(ExactFact {
        attribute: vocabulary::channel_participant(),
        value: ExactValue::new([u8::from(input.is_participant)])?,
    });
    if let Some(team) = input.team_id {
        facts.push(uuid_fact(vocabulary::channel_team(), team)?);
    }
    if let Some(organization) = input.organization_id {
        facts.push(ExactFact {
            attribute: vocabulary::channel_organization(),
            value: ExactValue::new(organization.to_be_bytes())?,
        });
    }
    let mut document = projection(
        input.record_key,
        vocabulary::profile_v4(),
        vocabulary::channel_partition(),
        facts,
        input.created_at,
        input.updated_at,
    )?;
    document.canonicalize();
    validate_soup_flat_v4(&document)?;
    Ok(document)
}
