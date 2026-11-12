//! Where Slack lives: production hosts, or a fake server's in tests.

use serde::{Deserialize, Serialize};
use url::Url;

use crate::ids::TeamId;

/// The hosts that aren't per workspace. Production uses [`Self::production`];
/// tests point every field at `slack_fake_server`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlackEndpoints {
    /// `https://slack.com/`: login (`api/signup.*`, `api/signin.*`) and
    /// `api/auth.test` before the workspace is known.
    pub slack: Url,
    /// `https://app.slack.com/`: magic login and the app's `/auth` page.
    pub app: Url,
    /// `https://edgeapi.slack.com/`: the user cache (`cache/<team>/users/info`).
    pub edge_api: Url,
    /// `wss://wss-primary.slack.com/`: the web client's real-time socket.
    pub websocket: Url,
    /// The browser user agent sent with cookie-authenticated requests.
    pub user_agent: String,
}

/// The user agent the web client's requests carry; Slack serves cookie
/// sessions only to browsers.
const BROWSER_USER_AGENT: &str =
    "Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0";

impl SlackEndpoints {
    /// Slack's production hosts.
    pub fn production() -> Self {
        Self {
            slack: static_url("https://slack.com/"),
            app: static_url("https://app.slack.com/"),
            edge_api: static_url("https://edgeapi.slack.com/"),
            websocket: static_url("wss://wss-primary.slack.com/"),
            user_agent: BROWSER_USER_AGENT.to_owned(),
        }
    }
}

fn static_url(literal: &str) -> Url {
    Url::parse(literal).expect("production Slack URLs are valid")
}

/// One workspace the session belongs to: its team id and its web URL
/// (`https://acme.slack.com/`, or `https://acme.enterprise.slack.com/` for a
/// Grid org). Web API calls go to `<url>api/<method>`, which routes Grid and
/// multi-workspace sessions to the right shard like the web client does.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackWorkspace {
    /// The workspace.
    pub team_id: TeamId,
    /// The workspace's web URL, with a trailing slash.
    pub url: Url,
}

impl SlackWorkspace {
    /// The Web API base, `<url>api/`.
    pub(crate) fn api_base(&self) -> Result<Url, url::ParseError> {
        self.url.join("api/")
    }
}
