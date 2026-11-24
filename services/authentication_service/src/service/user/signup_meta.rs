//! Meta click ids captured at signup and replayed on the create-user webhook.
//!
//! The browser pixel and the Conversions API `CompleteRegistration` share
//! `signup:{profile id}` (`macro|{email}`, the id the web app identifies
//! with). Click ids and the browser user agent are not on the FusionAuth
//! webhook unless the signup request stored them.

use analytics_client::MetaUserData;
use macro_env::Environment;
use serde_json::{Value, json};

const FBP_KEY: &str = "fbp";
const FBC_KEY: &str = "fbc";
const USER_AGENT_KEY: &str = "clientUserAgent";

const MAX_CLICK_ID_CHARS: usize = 512;
const MAX_USER_AGENT_CHARS: usize = 1024;

/// Browser attribution for one signup attempt.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct SignupClickIds {
    pub fbp: Option<String>,
    pub fbc: Option<String>,
    pub client_user_agent: Option<String>,
}

impl SignupClickIds {
    /// Keeps plausible Meta click ids and a printable user agent. Drops
    /// everything else so a query string cannot put an arbitrary blob on the
    /// conversion.
    pub(crate) fn from_parts(
        fbp: Option<&str>,
        fbc: Option<&str>,
        user_agent: Option<&str>,
    ) -> Self {
        Self {
            fbp: accepted_click_id(fbp),
            fbc: accepted_click_id(fbc),
            client_user_agent: accepted_user_agent(user_agent),
        }
    }

    pub(crate) fn from_user_data(data: Option<&Value>) -> Self {
        let Some(data) = data else {
            return Self::default();
        };
        Self::from_parts(
            data.get(FBP_KEY).and_then(Value::as_str),
            data.get(FBC_KEY).and_then(Value::as_str),
            data.get(USER_AGENT_KEY).and_then(Value::as_str),
        )
    }

    pub(crate) fn from_json(json: &str) -> Option<Self> {
        let value: Value = serde_json::from_str(json).ok()?;
        let parsed = Self::from_user_data(Some(&value));
        parsed.has_click_id().then_some(parsed)
    }

    pub(crate) fn has_click_id(&self) -> bool {
        self.fbp.is_some() || self.fbc.is_some()
    }

    /// The user-agent string used as part of the SSO stash key. The webhook
    /// and the login handler must normalize it the same way.
    pub(crate) fn normalized_user_agent(value: Option<&str>) -> Option<String> {
        accepted_user_agent(value)
    }

    /// Writes the fields FusionAuth will echo on `user.create`.
    pub(crate) fn merge_into(&self, data: &mut Value) {
        let Some(object) = data.as_object_mut() else {
            return;
        };
        if let Some(fbp) = &self.fbp {
            object.insert(FBP_KEY.to_string(), json!(fbp));
        }
        if let Some(fbc) = &self.fbc {
            object.insert(FBC_KEY.to_string(), json!(fbc));
        }
        if let Some(user_agent) = &self.client_user_agent {
            object.insert(USER_AGENT_KEY.to_string(), json!(user_agent));
        }
    }

    pub(crate) fn to_json(&self) -> String {
        json!({
            FBP_KEY: self.fbp,
            FBC_KEY: self.fbc,
            USER_AGENT_KEY: self.client_user_agent,
        })
        .to_string()
    }
}

/// `CompleteRegistration` is the account-created conversion. Agents are not
/// people the ad set is buying, and non-production services must not send
/// the production pixel.
pub(crate) fn sends_complete_registration(environment: Environment, is_agent: bool) -> bool {
    matches!(environment, Environment::Production) && !is_agent
}

/// Event id shared with the web app's `signupCompletion.ts`.
pub(crate) fn signup_event_id(profile_id: &str) -> String {
    format!("signup:{profile_id}")
}

/// User data for the signup conversion.
///
/// Click ids stored on the FusionAuth user (passwordless) win. A stash from
/// the SSO start is stored per address and user agent, and used only when
/// that user agent matches the webhook.
pub(crate) fn registration_user_data(
    email: &str,
    client_ip: &str,
    event_user_agent: Option<&str>,
    user_data: Option<&Value>,
    stashed: Option<SignupClickIds>,
) -> MetaUserData {
    let stored = SignupClickIds::from_user_data(user_data);
    let event_user_agent = accepted_user_agent(event_user_agent);
    let matched_stash = stashed.filter(|stashed| {
        event_user_agent.is_some() && event_user_agent == stashed.client_user_agent
    });
    let (fbp, fbc) = if stored.has_click_id() {
        (stored.fbp, stored.fbc)
    } else if let Some(stashed) = matched_stash {
        (stashed.fbp, stashed.fbc)
    } else {
        (None, None)
    };
    let client_ip = client_ip.trim();
    MetaUserData {
        email: Some(email.to_string()).filter(|email| !email.is_empty()),
        fbp,
        fbc,
        client_user_agent: stored.client_user_agent.or(event_user_agent),
        client_ip_address: (!client_ip.is_empty()).then(|| client_ip.to_string()),
    }
}

fn accepted_click_id(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.chars().count() > MAX_CLICK_ID_CHARS {
        return None;
    }
    if !value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '-' | '_'))
    {
        return None;
    }
    Some(value.to_string())
}

fn accepted_user_agent(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.chars().count() > MAX_USER_AGENT_CHARS {
        return None;
    }
    if value.chars().any(char::is_control) {
        return None;
    }
    Some(value.to_string())
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn signup_event_id_matches_the_web_app_profile_id() {
        assert_eq!(
            signup_event_id("macro|new.user@example.com"),
            "signup:macro|new.user@example.com"
        );
    }

    #[test]
    fn complete_registration_is_production_people_only() {
        assert!(sends_complete_registration(Environment::Production, false));
        assert!(!sends_complete_registration(Environment::Production, true));
        assert!(!sends_complete_registration(Environment::Develop, false));
        assert!(!sends_complete_registration(Environment::Local, false));
    }

    #[test]
    fn click_ids_reject_blank_and_unsafe_values() {
        let ids = SignupClickIds::from_parts(
            Some(" fb.1.2.3 "),
            Some("fb.1.2.<script>"),
            Some(" Mozilla/5.0 (test) "),
        );
        assert_eq!(ids.fbp.as_deref(), Some("fb.1.2.3"));
        assert_eq!(ids.fbc, None);
        assert_eq!(ids.client_user_agent.as_deref(), Some("Mozilla/5.0 (test)"));
        assert!(!SignupClickIds::from_parts(Some(""), None, None).has_click_id());
    }

    #[test]
    fn passwordless_user_data_supplies_click_ids_and_user_agent() {
        let mut data = json!({ "emailCodeSignup": true });
        SignupClickIds::from_parts(Some("fb.1.2.3"), Some("fb.1.4.Ab"), Some("Browser/1"))
            .merge_into(&mut data);

        let user_data = registration_user_data(
            "new.user@example.com",
            "198.51.100.42",
            Some("FusionAuth/1"),
            Some(&data),
            Some(SignupClickIds::from_parts(
                Some("fb.other"),
                None,
                Some("Browser/1"),
            )),
        );

        assert_eq!(user_data.email.as_deref(), Some("new.user@example.com"));
        assert_eq!(user_data.fbp.as_deref(), Some("fb.1.2.3"));
        assert_eq!(user_data.fbc.as_deref(), Some("fb.1.4.Ab"));
        assert_eq!(user_data.client_user_agent.as_deref(), Some("Browser/1"));
        assert_eq!(
            user_data.client_ip_address.as_deref(),
            Some("198.51.100.42")
        );
    }

    #[test]
    fn sso_stash_is_used_only_when_the_user_agent_matches() {
        let matching = registration_user_data(
            "new.user@example.com",
            "198.51.100.42",
            Some("Browser/1"),
            None,
            Some(SignupClickIds::from_parts(
                Some("fb.1.2.3"),
                Some("fb.1.4.Ab"),
                Some("Browser/1"),
            )),
        );
        assert_eq!(matching.fbp.as_deref(), Some("fb.1.2.3"));
        assert_eq!(matching.fbc.as_deref(), Some("fb.1.4.Ab"));

        let mismatched = registration_user_data(
            "new.user@example.com",
            "198.51.100.42",
            Some("Other/2"),
            None,
            Some(SignupClickIds::from_parts(
                Some("fb.1.2.3"),
                Some("fb.1.4.Ab"),
                Some("Browser/1"),
            )),
        );
        assert_eq!(mismatched.fbp, None);
        assert_eq!(mismatched.fbc, None);
        assert_eq!(mismatched.client_user_agent.as_deref(), Some("Other/2"));
    }

    #[test]
    fn stash_round_trips_through_json() {
        let ids = SignupClickIds::from_parts(Some("fb.1.2.3"), None, Some("Browser/1"));
        let parsed = SignupClickIds::from_json(&ids.to_json()).expect("click id");
        assert_eq!(parsed, ids);
        assert_eq!(SignupClickIds::from_json("not-json"), None);
    }
}
