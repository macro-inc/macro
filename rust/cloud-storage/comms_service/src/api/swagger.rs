use crate::api::{
    activity::get_activity::GetActivityResponse,
    activity::post_activity::PostActivityRequest,
    channels::{
        add_participants::AddParticipantsRequest,
        create_channel::{CreateChannelRequest, CreateChannelResponse},
        delete_message::DeleteMessageParams,
        get_channel::GetChannelResponse,
        get_channels::GetChannelsResponse,
        get_or_create_dm::{GetOrCreateDmRequest, GetOrCreateDmResponse},
        get_or_create_private::{GetOrCreatePrivateRequest, GetOrCreatePrivateResponse},
        patch_message::{PatchMessageParams, PatchMessageRequest},
        post_message::{PostMessageRequest, PostMessageResponse},
        post_reaction::{PostReactionRequest, ReactionAction},
        post_typing::PostTypingRequest,
        remove_participants::RemoveParticipantsRequest,
    },
    mentions::{
        CreateEntityMentionRequest, CreateEntityMentionResponse, DeleteEntityMentionRequest,
        DeleteEntityMentionResponse,
    },
    preview::get_batch_preview::{GetBatchChannelPreviewRequest, GetBatchChannelPreviewResponse},
};

use crate::api::extractors::ParticipantAccess;
use comms_db_client::channels::patch_channel::PatchChannelOptions;
use comms_db_client::model::{
    Activity, ActivityType, CountedReaction, EntityMention, Message, NewAttachment, Reaction,
    SimpleMention,
};
use model::comms::{
    Channel, ChannelParticipant, ChannelType, ChannelWithLatest, ChannelWithParticipants,
    GetMessageWithContextResponse, GetOrCreateAction, LatestMessage, ParticipantRole,
};

use model::response::{GenericErrorResponse, StringIDResponse};
use model::version::CommunicationServiceApiVersion;
use utoipa::OpenApi;

use super::channels::{
    add_participants, create_channel, delete_channel, delete_message, get_channel, get_channels,
    get_mentions, get_message_with_context, get_or_create_dm, get_or_create_private, join_channel,
    leave_channel, patch_channel, patch_message, post_message, post_reaction, post_typing,
    remove_participants,
};

use super::attachments::references;
use super::attachments::references::GetAttachmentReferencesResponse;
use comms_db_client::attachments::get_attachment_references::{
    ChannelReference, EntityReference, GenericReference,
};

use super::channels::get_mentions::GetMentionsResponse;

use super::activity::{get_activity, post_activity};
use super::mentions::{
    create_mention::__path_create_mention_handler, delete_mention::__path_delete_mention_handler,
};
use super::preview::get_batch_preview;

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            create_channel::create_channel_handler,
            get_channel::get_channel_handler,
            get_channels::get_channels_handler,
            post_message::post_message_handler,
            post_typing::post_typing_handler,
            post_reaction::post_reaction_handler,
            patch_message::patch_message_handler,
            delete_message::delete_message_handler,
            get_activity::get_activity_handler,
            post_activity::post_activity_handler,
            join_channel::join_channel_handler,
            leave_channel::leave_channel_handler,
            get_batch_preview::handler,
            remove_participants::handler,
            add_participants::handler,
            get_or_create_dm::handler,
            get_or_create_private::handler,
            delete_channel::delete_channel_handler,
            patch_channel::patch_channel_handler,
            references::handler,
            create_mention_handler,
            delete_mention_handler,
            get_mentions::handler,
            get_message_with_context::handler,
        ),
        components(
            schemas(
                CommunicationServiceApiVersion,
                CreateChannelRequest,
                CreateChannelResponse,
                GetChannelResponse,
                GetChannelsResponse,
                PostMessageRequest,
                PostMessageResponse,
                PostTypingRequest,
                StringIDResponse,
                GenericErrorResponse,
                PostReactionRequest,
                ReactionAction,
                PatchMessageParams,
                PatchMessageRequest,
                DeleteMessageParams,
                PostActivityRequest,
                GetActivityResponse,
                AddParticipantsRequest,
                RemoveParticipantsRequest,

                Channel,
                ChannelParticipant,
                ChannelType,
                ParticipantRole,
                Message,
                Reaction,
                CountedReaction,
                Activity,
                ActivityType,
                NewAttachment,
                ParticipantAccess,
                SimpleMention,
                EntityMention,

                GetBatchChannelPreviewRequest,
                GetBatchChannelPreviewResponse,

                GetOrCreateDmRequest,
                GetOrCreateDmResponse,

                GetOrCreatePrivateRequest,
                GetOrCreatePrivateResponse,

                GetOrCreateAction,
                PatchChannelOptions,

                GetAttachmentReferencesResponse,
                ChannelReference,
                GenericReference,
                EntityReference,

                CreateEntityMentionRequest,
                CreateEntityMentionResponse,
                DeleteEntityMentionRequest,
                DeleteEntityMentionResponse,

                GetMentionsResponse,
                ChannelWithLatest,
                ChannelWithParticipants,
                LatestMessage,
                GetMessageWithContextResponse,
            ),
        ),
        tags(
            (name = "macro comms service", description = "Comms Service")
        )
    )]
pub struct ApiDoc;
