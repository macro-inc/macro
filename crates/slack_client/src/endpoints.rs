//! Where Slack lives: Slack's hosts from `macro_service_urls`, or a fake
//! server's in tests.

use macro_service_urls::{SlackAppUrl, SlackEdgeApiUrl, SlackUrl, SlackWebsocketUrl};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::ids::TeamId;

/// The hosts that aren't per workspace. Services use
/// [`Self::from_service_urls`]; tests point every field at
/// `slack_fake_server`.
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
    /// Slack's hosts as `macro_service_urls` resolves them (Slack's own,
    /// unless an `OVERRIDE_SLACK_*` variable points at a fake).
    pub fn from_service_urls() -> Result<Self, EndpointsError> {
        Ok(Self {
            slack: parse(SlackUrl::new()?.as_str())?,
            app: parse(SlackAppUrl::new()?.as_str())?,
            edge_api: parse(SlackEdgeApiUrl::new()?.as_str())?,
            websocket: parse(SlackWebsocketUrl::new()?.as_str())?,
            user_agent: BROWSER_USER_AGENT.to_owned(),
        })
    }

    /// The page Slack's sign-in captcha belongs to.
    pub fn sign_in_page(&self) -> Url {
        self.slack
            .join("signin")
            .expect("a relative path joins onto the Slack URL")
    }

    /// The `Origin` the web client's requests carry: the web app's.
    pub(crate) fn web_origin(&self) -> String {
        self.app.origin().ascii_serialization()
    }
}

/// Slack's hosts couldn't be resolved.
#[derive(Debug, thiserror::Error)]
pub enum EndpointsError {
    /// An override variable couldn't be read.
    #[error(transparent)]
    Variable(#[from] macro_service_urls::ServiceUrlVarErr),
    /// A URL doesn't parse.
    #[error("invalid Slack URL {url}: {source}")]
    Invalid {
        /// The URL.
        url: String,
        /// Why.
        source: url::ParseError,
    },
}

fn parse(url: &str) -> Result<Url, EndpointsError> {
    Url::parse(url).map_err(|source| EndpointsError::Invalid {
        url: url.to_owned(),
        source,
    })
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
