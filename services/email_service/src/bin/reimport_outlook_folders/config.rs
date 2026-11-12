use email::domain::mailbox::reimport::ReimportMode;
use macro_env_var::{env_vars, maybe_env_vars};
use rootcause::prelude::{Report, ResultExt as _};
use uuid::Uuid;

/// Links re-importing at once is capped so a typo cannot start a large share
/// of the fleet's mailboxes together.
const MAX_CONCURRENCY: usize = 10;

pub struct Config {
    pub database_url: DatabaseUrl,
    /// Links to visit, in this order. When unset, every Outlook link, oldest
    /// connection first.
    pub link_ids: Option<Vec<Uuid>>,
    /// Links re-importing at once. Defaults to 1.
    pub concurrency: usize,
    pub mode: ReimportMode,
}

env_vars! {
    pub struct DatabaseUrl;
}

maybe_env_vars! {
    struct LinkIds;
    struct Concurrency;
    struct Verify;
}

impl Config {
    pub fn from_env() -> Result<Self, Report> {
        let link_ids = LinkIds::new()
            .map(|ids| {
                ids.split(',')
                    .map(|id| Uuid::parse_str(id.trim()))
                    .collect::<Result<Vec<_>, _>>()
                    .context("LINK_IDS is not a comma-separated list of UUIDs")
            })
            .transpose()?;
        let concurrency = Concurrency::new()
            .map(|n| n.parse::<usize>().context("CONCURRENCY is not a number"))
            .transpose()?
            .map_or(1, |n| n.clamp(1, MAX_CONCURRENCY));
        let verify = Verify::new()
            .map(|v| v.parse::<bool>().context("VERIFY is not a bool"))
            .transpose()?;

        Ok(Self {
            database_url: DatabaseUrl::new()?,
            link_ids,
            concurrency,
            mode: if verify == Some(true) {
                ReimportMode::Verify
            } else {
                ReimportMode::Apply
            },
        })
    }
}
