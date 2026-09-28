pub(crate) static INVITE_USER_SUBJECT: &str = "Invitation to Macro";

/// Builds the user invite message
pub(crate) fn build_user_invite_message(org_name: &str, environment: &str) -> String {
    let prefix = match environment {
        "prod" => "".to_string(),
        _ => format!("{}.", environment),
    };

    let result = include_str!("../templates/invite_user.html");

    let result = result.replace("{PREFIX}", prefix.as_str());
    result.replace("{ORG_NAME}", &html_escape::encode_text(org_name))
}

#[cfg(test)]
mod test;
