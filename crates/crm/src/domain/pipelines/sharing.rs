//! Pipeline channel-sharing request policy.

use super::*;

/// Most channel grants one request may change.
const MAX_CHANNEL_GRANTS_PER_UPDATE: usize = 100;

/// The channel grants of a sharing request. Pipelines have no share link, and
/// team access changes only through [`PipelineService::share`].
pub(super) fn requested_channel_grants(
    request: UpdateSharePermissionRequestV2,
) -> Result<Vec<UpdateChannelSharePermission>, PipelineError> {
    if request.link_share.is_some()
        || request.link_share_access_level.is_some()
        || request.team_share_access_level.is_some()
    {
        return Err(PipelineError::Invalid(
            "Share a pipeline with people and channels; only its owner changes team access",
        ));
    }
    let grants = request.channel_share_permissions.unwrap_or_default();
    if grants.len() > MAX_CHANNEL_GRANTS_PER_UPDATE {
        return Err(PipelineError::Invalid(
            "Share with at most 100 channels at a time",
        ));
    }
    let mut channels = std::collections::HashSet::new();
    for grant in &grants {
        if !channels.insert(&grant.channel_id)
            || Uuid::parse_str(&grant.channel_id).is_err()
            || grant.access_level == Some(AccessLevel::Owner)
            || (grant.operation != UpdateOperation::Remove && grant.access_level.is_none())
        {
            return Err(PipelineError::Invalid(
                "Give each channel once, with view, comment or edit access",
            ));
        }
    }
    Ok(grants)
}

pub(super) fn share_permission(
    pipeline: &Pipeline,
    channels: Vec<ChannelSharePermission>,
) -> SharePermissionV2 {
    SharePermissionV2 {
        id: pipeline.id.to_string(),
        owner: pipeline.user_id.clone(),
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: (pipeline.sharing == PipelineSharing::Team)
            .then_some(AccessLevel::Edit),
        channel_share_permissions: Some(channels),
    }
}
