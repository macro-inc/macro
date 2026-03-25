use comms::domain::models::channel_name::resolve_channel_name;
use comms_db_client::model::{ChannelPreview, ChannelPreviewData, WithChannelId};
use comms_db_client::preview::Previews;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_comms::channel::ChannelId;
use std::collections::HashMap;

pub fn resolve_previews(
    context: MacroUserIdStr<'_>,
    raw_previews: Previews,
    name_lookup: &HashMap<MacroUserIdStr<'static>, String>,
) -> Vec<ChannelPreview> {
    let mut previews = vec![];

    let not_existing: Vec<ChannelPreview> = raw_previews
        .remaining
        .iter()
        .map(|preview| {
            ChannelPreview::DoesNotExist(WithChannelId {
                channel_id: preview.clone(),
            })
        })
        .collect();

    let existing: Vec<ChannelPreview> = raw_previews
        .exists
        .iter()
        .map(|preview| {
            let participants: Vec<_> = preview
                .participants
                .iter()
                .map(|p| models_comms::channel::ChannelParticipant {
                    channel_id: p.channel_id,
                    user_id: p.user_id.clone(),
                    role: match p.role {
                        model::comms::ParticipantRole::Owner => {
                            models_comms::channel::ParticipantRole::Owner
                        }
                        model::comms::ParticipantRole::Admin => {
                            models_comms::channel::ParticipantRole::Admin
                        }
                        model::comms::ParticipantRole::Member => {
                            models_comms::channel::ParticipantRole::Member
                        }
                    },
                    joined_at: p.joined_at,
                    left_at: p.left_at,
                })
                .collect();

            let resolved_name = resolve_channel_name(
                &match preview.channel_type {
                    model::comms::ChannelType::Public => models_comms::channel::ChannelType::Public,
                    model::comms::ChannelType::Organization => {
                        models_comms::channel::ChannelType::Organization
                    }
                    model::comms::ChannelType::Private => {
                        models_comms::channel::ChannelType::Private
                    }
                    model::comms::ChannelType::DirectMessage => {
                        models_comms::channel::ChannelType::DirectMessage
                    }
                    model::comms::ChannelType::Team => models_comms::channel::ChannelType::Team,
                },
                preview.channel_name.as_deref(),
                &participants,
                &ChannelId(preview.channel_id),
                context.copied(),
                name_lookup,
            );
            ChannelPreview::Access(ChannelPreviewData {
                channel_id: preview.channel_id.to_string(),
                channel_name: resolved_name,
                channel_type: preview.channel_type,
            })
        })
        .collect();

    previews.extend(existing);
    previews.extend(not_existing);

    previews
}
