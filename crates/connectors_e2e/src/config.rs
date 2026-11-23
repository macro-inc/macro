//! What a run needs: the two accounts' API keys and the fixtures they hold,
//! read from the process environment. CI passes them from repository secrets
//! and variables (`.github/workflows/connectors_e2e.yml`).

use crate::Report;
use crate::api::{Account, AccountKind};

/// The API key of the `@macro.com` test account, on the Connect
/// rollout: a Macro user API key (`mak_…`). A secret.
pub const FLAGGED_API_KEY: &str = "CONNECTORS_E2E_FLAGGED_API_KEY";
/// The API key of the test account off the rollout. A secret.
pub const UNFLAGGED_API_KEY: &str = "CONNECTORS_E2E_UNFLAGGED_API_KEY";
/// An app the flagged account connected through Macro Connect.
pub const CONNECT_APP: &str = "CONNECTORS_E2E_CONNECT_APP";
/// An app the unflagged account connected through Pipedream.
pub const PIPEDREAM_APP: &str = "CONNECTORS_E2E_PIPEDREAM_APP";
/// Set when the unflagged account has linked its GitHub account.
pub const GITHUB_LINKED: &str = "CONNECTORS_E2E_GITHUB_LINKED";
/// A real MCP server that needs no sign-in; the suite adds and removes it.
pub const MCP_SERVER_URL: &str = "CONNECTORS_E2E_MCP_SERVER_URL";
/// A Notion page the account holding Notion can read: the API check imports it.
pub const NOTION_PAGE: &str = "CONNECTORS_E2E_NOTION_PAGE";

/// One run's accounts and fixtures.
pub struct Suite {
    /// The `@macro.com` account, on the Connect rollout.
    pub flagged: Account,
    /// The account off the rollout.
    pub unflagged: Account,
    /// What the accounts hold.
    pub fixtures: Fixtures,
}

/// What the test accounts hold, as the operator set them up. Each scenario
/// that needs one skips when it is not set.
#[derive(Debug, Clone, Default)]
pub struct Fixtures {
    /// An app slug the flagged account connected through Macro Connect, one
    /// Connect supports.
    pub connect_app: Option<String>,
    /// An app slug the unflagged account connected through Pipedream.
    pub pipedream_app: Option<String>,
    /// Whether the unflagged account has linked its GitHub account.
    pub github_linked: bool,
    /// A real MCP server that needs no sign-in.
    pub mcp_server_url: Option<String>,
    /// A Notion page the account holding Notion can read.
    pub notion_page: Option<String>,
}

impl Suite {
    /// The suite, or `None` (with a skip message on stderr naming `scenario`)
    /// when either account's API key is not set: a run without secrets skips
    /// every scenario and passes.
    pub fn from_env(scenario: &str) -> Result<Option<Self>, Report> {
        let (Some(flagged), Some(unflagged)) =
            (setting(FLAGGED_API_KEY), setting(UNFLAGGED_API_KEY))
        else {
            eprintln!(
                "SKIP {scenario}: set {FLAGGED_API_KEY} and {UNFLAGGED_API_KEY} to run the \
                 connectors end-to-end suite against dev"
            );
            return Ok(None);
        };
        Ok(Some(Self {
            flagged: Account::new(AccountKind::Flagged, &flagged)?,
            unflagged: Account::new(AccountKind::Unflagged, &unflagged)?,
            fixtures: Fixtures {
                connect_app: setting(CONNECT_APP),
                pipedream_app: setting(PIPEDREAM_APP),
                github_linked: setting(GITHUB_LINKED).is_some(),
                mcp_server_url: setting(MCP_SERVER_URL),
                notion_page: setting(NOTION_PAGE),
            },
        }))
    }
}

/// Says that `scenario` skips because `setting` is not set.
pub fn skip(scenario: &str, setting: &str) {
    eprintln!("SKIP {scenario}: set {setting} to run it");
}

/// A setting, absent when unset or blank.
fn setting(name: &str) -> Option<String> {
    #[expect(
        clippy::disallowed_methods,
        reason = "test support: the suite's own settings come from the process environment"
    )]
    let value = std::env::var(name).ok()?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}
