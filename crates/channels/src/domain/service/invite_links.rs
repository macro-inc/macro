use super::*;
use crate::domain::models::ChannelInfo;
use chrono::{DateTime, Duration, Utc};

pub(super) const INVITE_LIFETIME: Duration = Duration::days(14);

impl<R, E, P, M, F> ChannelServiceImpl<R, E, P, M, F>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    M: ChannelMentionExtractor,
    F: ChannelPictureFiles,
{
    pub(super) async fn create_invite_link(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
    ) -> Result<ChannelJoinCodeResponse, ChannelMutationErr> {
        let channel_id = Uuid::parse_str(&access.entity().entity_id)
            .map_err(|e| ChannelMutationErr::BadRequest(e.to_string()))?;
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        validate_channel_type(&info)?;
        // A bearer secret must be random, independent of time-sortable entity IDs.
        let join_code = Uuid::new_v4();
        self.repo
            .create_channel_invite_link(channel_id, join_code, Utc::now() + INVITE_LIFETIME)
            .await
            .map_err(|e| ChannelMutationErr::Repo(e.into()))?;
        Ok(ChannelJoinCodeResponse { join_code })
    }
}

fn validate_channel_type(info: &ChannelInfo) -> Result<(), ChannelMutationErr> {
    if !matches!(info.channel_type, ChannelType::Private | ChannelType::Team) {
        return Err(ChannelMutationErr::Forbidden(
            "invite links are only available for private and team channels".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn validate_invitation(
    info: &ChannelInfo,
    expires_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<(), ChannelMutationErr> {
    if expires_at <= now {
        return Err(ChannelMutationErr::NotFound(
            "channel invitation expired".to_string(),
        ));
    }
    validate_channel_type(info)
}
