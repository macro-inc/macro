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
