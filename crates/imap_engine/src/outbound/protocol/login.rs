//! A provider's temporary login outage must not park an otherwise valid account.
use crate::domain::models::Error;

pub(super) fn login_failure(response: &str) -> Error {
    // async-imap retains unknown RFC response codes in the information string.
    // Only a leading code is authoritative; diagnostic prose can contain words
    // such as "unavailable" even when the server explicitly rejected the login.
    let information = response
        .strip_prefix("code: None, info: Some(\"")
        .unwrap_or(response);
    if let Some(code) = information
        .strip_prefix('[')
        .and_then(|value| value.split_once(']').map(|(code, _)| code))
    {
        return match code.to_ascii_uppercase().as_str() {
            "AUTHENTICATIONFAILED" | "EXPIRED" => Error::CredentialsRejected,
            "AUTHORIZATIONFAILED" | "PRIVACYREQUIRED" => Error::Forbidden,
            _ => Error::ConnectionUnavailable,
        };
    }
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
    if tokens
        .clone()
        .any(|token| matches!(token, "authenticationfailed" | "expired"))
        || [
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
