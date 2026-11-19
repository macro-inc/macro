//! A provider's temporary login outage must not park an otherwise valid account.
use crate::domain::models::Error;

pub(super) fn login_failure(response: &str) -> Error {
    let normalized = response
        .chars()
        .take(4096)
        .collect::<String>()
        .to_ascii_lowercase();
    let tokens = normalized.split(|c: char| !c.is_ascii_alphanumeric());
    if tokens
        .clone()
        .any(|token| matches!(token, "unavailable" | "serverbug" | "inuse" | "limit"))
        || normalized.contains("user is authenticated but not connected")
    {
        return Error::ConnectionUnavailable;
    }
    if tokens.clone().any(|token| {
        matches!(
            token,
            "authenticationfailed" | "authorizationfailed" | "expired" | "privacyrequired"
        )
    }) || [
        "authentication failed",
        "authentication failure",
        "invalid password",
        "invalid credentials",
        "login failed",
        "invalid login",
        "invalid username",
        "unknown user",
        "bad credentials",
        "authentication unsuccessful",
    ]
    .iter()
    .any(|v| normalized.contains(v))
    {
        Error::CredentialsRejected
    } else {
        Error::ConnectionUnavailable
    }
}

#[cfg(test)]
mod test;
