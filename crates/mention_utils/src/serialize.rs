use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;

#[cfg(test)]
mod test;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserMention<'a> {
    user_id: &'a str,
    email: &'a str,
}

/// Serialize a Macro user as an in-app user mention node.
pub fn user_mention(user_id: &MacroUserIdStr<'_>) -> Result<String, serde_json::Error> {
    let payload = tag_json(&UserMention {
        user_id: user_id.as_ref(),
        email: user_id.email_str(),
    })?;
    Ok(format!("<m-user-mention>{payload}</m-user-mention>"))
}

/// Serialize a bot as an in-app user mention node. Bot mentions ride the
/// user-mention tag with a `bot|<uuid>` id and the display name in the email
/// field.
pub fn bot_mention(bot_id: BotId, display_name: &str) -> Result<String, serde_json::Error> {
    let storage_id = bot_id.into_storage_id();
    let payload = tag_json(&UserMention {
        user_id: storage_id.as_ref(),
        email: display_name,
    })?;
    Ok(format!("<m-user-mention>{payload}</m-user-mention>"))
}

/// Serialize JSON without literal tag delimiters. JSON decoding restores the
/// original text; HTML/entity escaping here would change labels.
fn tag_json(value: &impl Serialize) -> Result<String, serde_json::Error> {
    Ok(serde_json::to_string(value)?
        .replace('<', "\\u003c")
        .replace('>', "\\u003e"))
}

/// Invalid external link input: scheme policy is separate from URL syntax.
#[derive(Debug, thiserror::Error)]
pub enum LinkError {
    /// Only HTTP, HTTPS and mailto are supported by the frontend.
    #[error("unsupported URL scheme")]
    UnsafeScheme,
    /// The URL is malformed or contains ambiguous literal delimiters/controls.
    #[error("malformed URL")]
    MalformedUrl,
}

/// A validated external URL with an untrusted display label, not markdown.
#[derive(Serialize)]
pub struct ExternalLink<'a> {
    url: &'a str,
    text: &'a str,
    title: &'static str,
}

impl<'a> ExternalLink<'a> {
    /// Validate independently of serialization, preserving the original URL.
    pub fn new(url: &'a str, text: &'a str) -> Result<Self, LinkError> {
        let (scheme, rest) = url.split_once(':').ok_or(LinkError::MalformedUrl)?;
        if !matches!(
            scheme.to_ascii_lowercase().as_str(),
            "http" | "https" | "mailto"
        ) {
            return Err(LinkError::UnsafeScheme);
        }
        if url.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | '\\' | '"' | '`')
        }) {
            return Err(LinkError::MalformedUrl);
        }
        let parsed = url::Url::parse(url).map_err(|_| LinkError::MalformedUrl)?;
        if parsed.scheme() == "mailto" {
            if parsed.path().is_empty() {
                return Err(LinkError::MalformedUrl);
            }
        } else if !rest.starts_with("//") || rest.starts_with("///") || parsed.host_str().is_none()
        {
            return Err(LinkError::MalformedUrl);
        }
        Ok(Self {
            url,
            text,
            title: "",
        })
    }

    /// Emit the native Lexical link representation.
    pub fn serialize(&self) -> Result<String, serde_json::Error> {
        Ok(format!("<m-link>{}</m-link>", tag_json(self)?))
    }
}

/// Channel navigation parameters use snake_case inside camelCase mention JSON.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct ChannelMentionParams<'a> {
    /// Canonical Macro message UUID, never a Slack timestamp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_message_id: Option<&'a str>,
    /// Canonical persisted Macro root UUID for a thread/reply target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_thread_id: Option<&'a str>,
}

/// Serialize a channel or a message within that channel. `document_id` is always
/// the channel UUID, including when message navigation parameters are present.
pub fn channel_mention(
    document_id: &str,
    document_name: &str,
    params: ChannelMentionParams<'_>,
) -> Result<String, serde_json::Error> {
    let payload = tag_json(&DocumentMention {
        document_id,
        block_name: "channel",
        document_name,
        block_params: params,
        collapsed: false,
    })?;
    Ok(format!(
        "<m-document-mention>{payload}</m-document-mention>"
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentMention<'a, P> {
    document_id: &'a str,
    block_name: &'a str,
    document_name: &'a str,
    block_params: P,
    collapsed: bool,
}

/// Serialize a markdown document as an in-app document mention node.
pub fn document_mention(
    document_id: &str,
    document_name: &str,
) -> Result<String, serde_json::Error> {
    let payload = serde_json::to_string(&DocumentMention {
        document_id,
        block_name: "md",
        document_name,
        block_params: serde_json::Map::new(),
        collapsed: false,
    })?;
    Ok(format!(
        "<m-document-mention>{payload}</m-document-mention>"
    ))
}
