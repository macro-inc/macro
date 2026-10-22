//! Who may ask to join a channel, how often, and how participants answer.

use super::{ChannelServiceImpl, participant_ids};
use crate::domain::{
    access_requests::{
        ChannelAccessDecision, ChannelAccessRequest, ChannelAccessRequestErr,
        ChannelAccessRequestRepo, ChannelAccessRequestService, ChannelAccessRequestState,
        ChannelAccessRequestStatus, accepts_requests,
    },
    events::ChannelEvent,
    models::Sender,
    ports::{
        ChannelEventDispatcher, ChannelPictureFiles, ChannelReferenceSharePermissions, ChannelRepo,
    },
};
use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, MemberParticipantRole};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

fn repo_err(error: impl Into<anyhow::Error>) -> ChannelAccessRequestErr {
    ChannelAccessRequestErr::Repo(error.into())
}

fn receipt_channel_id(
    access: &EntityAccessReceipt<MemberParticipantRole>,
) -> Result<Uuid, ChannelAccessRequestErr> {
    if access.entity().entity_type != EntityType::Channel {
        return Err(ChannelAccessRequestErr::ChannelNotFound);
    }
    Uuid::parse_str(&access.entity().entity_id)
        .map_err(|_| ChannelAccessRequestErr::ChannelNotFound)
}

impl<R, E, P, F> ChannelAccessRequestService for ChannelServiceImpl<R, E, P, F>
where
    R: ChannelRepo + ChannelAccessRequestRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    F: ChannelPictureFiles,
{
    #[tracing::instrument(name = "channel_access_requests.mine", skip_all, fields(channel_id = %channel_id), err)]
    async fn my_access_request(
        &self,
        user: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<ChannelAccessRequestState, ChannelAccessRequestErr> {
        let info = self
            .repo
            .find_channel_info(channel_id)
            .await
            .map_err(repo_err)?
            .ok_or(ChannelAccessRequestErr::ChannelNotFound)?;
        let request = self
            .repo
            .latest_access_request(channel_id, &user)
            .await
            .map_err(repo_err)?;
        let now = Utc::now();
        let retry_after = request
            .as_ref()
            .and_then(ChannelAccessRequest::retry_after)
            .filter(|until| *until > now);
        Ok(ChannelAccessRequestState {
            request,
            can_request: accepts_requests(info.channel_type),
            retry_after,
        })
    }

    #[tracing::instrument(name = "channel_access_requests.submit", skip_all, fields(channel_id = %channel_id), err)]
    async fn request_access(
        &self,
        user: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<ChannelAccessRequest, ChannelAccessRequestErr> {
        let info = self
            .repo
            .find_channel_info(channel_id)
            .await
            .map_err(repo_err)?
            .ok_or(ChannelAccessRequestErr::ChannelNotFound)?;
        if !accepts_requests(info.channel_type) {
            return Err(ChannelAccessRequestErr::NotRequestable(
                "only private and team channels accept requests to join",
            ));
        }
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(repo_err)?;
        if participants.iter().any(|p| p.user_id == user.as_ref()) {
            return Err(ChannelAccessRequestErr::NotRequestable(
                "you are already in this channel",
            ));
        }
        let now = Utc::now();
        if let Some(latest) = self
            .repo
            .latest_access_request(channel_id, &user)
            .await
            .map_err(repo_err)?
        {
            if latest.status == ChannelAccessRequestStatus::Pending {
                return Ok(latest);
            }
            if let Some(until) = latest.retry_after()
                && now < until
            {
                return Err(ChannelAccessRequestErr::Cooldown(until));
            }
        }
        // Everything the announcement needs is read before the attempt is
        // stored, so a stored attempt is never left unannounced.
        let metadata = self
            .repo
            .get_channel_metadata(channel_id, user.clone())
            .await
            .map_err(repo_err)?;
        let (request, created) = self
            .repo
            .create_access_request(&ChannelAccessRequest {
                id: Uuid::now_v7(),
                channel_id,
                requester_id: user,
                status: ChannelAccessRequestStatus::Pending,
                created_at: now,
                resolved_at: None,
                resolved_by: None,
            })
            .await
            .map_err(repo_err)?;
        if created {
            self.events.dispatch(ChannelEvent::AccessRequested {
                request: request.clone(),
                participant_user_ids: participant_ids(&participants),
                metadata,
            });
        }
        Ok(request)
    }

    #[tracing::instrument(name = "channel_access_requests.cancel", skip_all, fields(channel_id = %channel_id), err)]
    async fn cancel_access_request(
        &self,
        user: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<(), ChannelAccessRequestErr> {
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(repo_err)?;
        let Some(request) = self
            .repo
            .cancel_access_request(channel_id, &user, Utc::now())
            .await
            .map_err(repo_err)?
        else {
            return Ok(());
        };
        self.events.dispatch(ChannelEvent::AccessRequestResolved {
            request,
            participant_user_ids: participant_ids(&participants),
        });
        Ok(())
    }

    #[tracing::instrument(name = "channel_access_requests.get", skip_all, fields(request_id = %request_id), err)]
    async fn get_access_request(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        request_id: Uuid,
    ) -> Result<ChannelAccessRequest, ChannelAccessRequestErr> {
        let channel_id = receipt_channel_id(&access)?;
        self.repo
            .get_access_request(channel_id, request_id)
            .await
            .map_err(repo_err)?
            .ok_or(ChannelAccessRequestErr::NotFound)
    }

    #[tracing::instrument(name = "channel_access_requests.resolve", skip_all, fields(request_id = %request_id, decision = ?decision), err)]
    async fn resolve_access_request(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        request_id: Uuid,
        decision: ChannelAccessDecision,
    ) -> Result<ChannelAccessRequest, ChannelAccessRequestErr> {
        let channel_id = receipt_channel_id(&access)?;
        let actor = access
            .get_authenticated_user()
            .cloned()
            .map_err(|_| ChannelAccessRequestErr::Forbidden)?;
        let request = self
            .repo
            .get_access_request(channel_id, request_id)
            .await
            .map_err(repo_err)?
            .ok_or(ChannelAccessRequestErr::NotFound)?;
        if request.requester_id == actor {
            return Err(ChannelAccessRequestErr::Forbidden);
        }
        // Read what the follow-up events need first, so a resolved attempt is
        // never left without its notifications and membership activity.
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(repo_err)?;
        let added_to = match decision {
            ChannelAccessDecision::Approve => Some((
                self.repo
                    .get_channel_info(channel_id)
                    .await
                    .map_err(repo_err)?
                    .channel_type,
                self.repo
                    .get_channel_metadata(channel_id, actor.clone())
                    .await
                    .map_err(repo_err)?,
            )),
            ChannelAccessDecision::Deny => None,
        };
        let resolved = self
            .repo
            .resolve_access_request(channel_id, request_id, &actor, decision, Utc::now())
            .await
            .map_err(repo_err)?
            .ok_or(ChannelAccessRequestErr::Conflict)?;

        let mut participant_user_ids = participant_ids(&participants);
        self.events.dispatch(ChannelEvent::AccessRequestResolved {
            request: resolved.request.clone(),
            participant_user_ids: participant_user_ids.clone(),
        });
        if let Some((channel_type, metadata)) = added_to
            && resolved.joined
        {
            let requester = resolved.request.requester_id.clone();
            participant_user_ids.push(requester.clone());
            self.events.dispatch(ChannelEvent::ParticipantsAdded {
                channel_id,
                channel_type,
                active_participant_user_ids: participant_user_ids,
                invited_by: Sender::new_from_user(actor),
                recipient_user_ids: vec![requester],
                metadata,
                message_content: None,
            });
        }
        Ok(resolved.request)
    }
}
