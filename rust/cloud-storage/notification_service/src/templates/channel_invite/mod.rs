use model_notifications::ChannelInviteMetadata;
use url::Url;

use crate::templates::add_skip_offboarding_query_param;

static BASIC_TEMPLATE: &str = include_str!("./_channel_invite_basic_template.html");

static SUBJECT: &str = "Macro Channel Invite";

fn transform_channel_type(channel_type: &str) -> String {
    match channel_type {
        "private" => "group channel",
        "public" => "public channel",
        "direct_message" => "direct message",
        "organization" => "organization channel",
        _ => "",
    }
    .to_string()
}

fn create_invite_message(channel_name: Option<&str>, channel_type: &str) -> String {
    if let Some(channel_name) = channel_name {
        format!("invited you to #{}.", channel_name)
    } else {
        format!("invited you to a {}.", transform_channel_type(channel_type))
    }
}

fn fill_channel_invite_basic_template(
    channel_url: &Url,
    invited_by: &str,
    channel_name: Option<&str>,
    channel_type: &str,
) -> String {
    let invite_message = create_invite_message(channel_name, channel_type);

    BASIC_TEMPLATE
        .replace("{{INVITED_BY}}", invited_by)
        .replace("{{INVITE_MESSAGE}}", &invite_message)
        .replace("{{CHANNEL_URL}}", channel_url.as_str())
}

pub fn fill_channel_invite_template(
    channel_url: &Url,
    channel_metadata: &ChannelInviteMetadata,
) -> anyhow::Result<(String, String)> {
    let subject = SUBJECT;

    let mut channel_url = channel_url.clone();
    channel_url = add_skip_offboarding_query_param(channel_url);

    let content = fill_channel_invite_basic_template(
        &channel_url,
        &channel_metadata.invited_by.to_string(),
        Some(&channel_metadata.common.channel_name),
        &channel_metadata.common.channel_type.to_string(),
    );

    Ok((content, subject.to_string()))
}
