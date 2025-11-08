use url::Url;

static NAMED_TEMPLATE: &str = include_str!("./_channel_message_named_template.html");

static SUBJECT: &str = "Macro Unread Message";

static CHANNEL_INVITE_ICON: &str = "https://coparse-release-artifact-storage-bucket.s3.us-east-1.amazonaws.com/item_share_icons/user.png";

fn fill_channel_message_named_template(channel_url: &Url, channel_name: &str) -> String {
    NAMED_TEMPLATE
        .replace("{{ITEM_SHARE_ICON}}", CHANNEL_INVITE_ICON)
        .replace("{{CHANNEL_NAME}}", channel_name)
        .replace("{{CHANNEL_URL}}", channel_url.as_str())
}

pub fn fill_channel_message_template(channel_url: &Url, channel_name: &str) -> (String, String) {
    let subject = SUBJECT;

    let content = fill_channel_message_named_template(channel_url, channel_name);

    (content, subject.to_string())
}
