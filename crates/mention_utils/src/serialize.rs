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
    let payload = serde_json::to_string(&UserMention {
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
    let payload = serde_json::to_string(&UserMention {
        user_id: storage_id.as_ref(),
        email: display_name,
    })?;
    Ok(format!("<m-user-mention>{payload}</m-user-mention>"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentMention<'a> {
    document_id: &'a str,
    block_name: &'a str,
    document_name: &'a str,
    block_params: serde_json::Map<String, serde_json::Value>,
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
