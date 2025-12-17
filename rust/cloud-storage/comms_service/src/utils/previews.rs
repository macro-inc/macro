use comms_db_client::model::{ChannelPreview, ChannelPreviewData, WithChannelId};
use comms_db_client::preview::Previews;
use model::user::UserContext;
use std::collections::HashMap;

use crate::utils::channel_name::resolve_channel_name;

pub fn resolve_previews(
    context: &UserContext,
    raw_previews: Previews,
    name_lookup: Option<&HashMap<String, String>>,
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
                },
                preview.channel_name.as_deref(),
                &preview.participants,
                &preview.channel_id,
                &context.user_id,
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
