pub(crate) static INVITE_USER_SUBJECT: &str = "Invitation to Macro";

/// Builds the user invite message
pub(crate) fn build_user_invite_message(org_name: &str, environment: &str) -> String {
    let prefix = match environment {
        "prod" => "".to_string(),
        _ => format!("{}.", environment),
    };

    let result = include_str!("../templates/invite_user.html");

    let result = result.replace("{PREFIX}", prefix.as_str());
    result.replace("{ORG_NAME}", org_name)
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_build_user_invite_message() {
        // let result = build_user_invite_message("prod");
        // let expected = "Visit <a href=\"https://macro.com/app?login=true\">Macro</a> to login";
        // assert!(result.contains(expected));
        //
        // let result = build_user_invite_message("staging");
        // let expected =
        //     "Visit <a href=\"https://staging.macro.com/app?login=true\">Macro</a> to login";
        // assert!(result.contains(expected));
        //
        // let result = build_user_invite_message("dev");
        // let expected = "Visit <a href=\"https://dev.macro.com/app?login=true\">Macro</a> to login";
        // assert!(result.contains(expected));
    }
}
