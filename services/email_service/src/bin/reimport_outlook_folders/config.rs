use email::domain::mailbox::reimport::ReimportMode;
use macro_env_var::{env_vars, maybe_env_vars};
use rootcause::prelude::{Report, ResultExt as _};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Links re-importing at once is capped so a typo cannot start a large share
/// of the fleet's mailboxes together.
const MAX_CONCURRENCY: usize = 10;

pub struct Config {
    pub database_url: DatabaseUrl,
    /// Links to visit, in this order. When unset, every Outlook link, oldest
    /// connection first, which a real run must ask for with `ALL_LINKS`.
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
    struct AllLinks;
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
        let all_links = AllLinks::new()
            .map(|v| v.parse::<bool>().context("ALL_LINKS is not a bool"))
            .transpose()?
            .unwrap_or(false);
        let mode = if verify == Some(true) {
            ReimportMode::Verify
        } else {
            ReimportMode::Apply
        };

        Ok(Self {
            database_url: DatabaseUrl::new()?,
            link_ids: links(link_ids, all_links, mode)?,
            concurrency,
            mode,
        })
    }
}

/// Which links a run visits: `None` is every Outlook link. A real run that
/// names no links must say it means all of them, so a bare run changes
/// nothing; a dry run without `LINK_IDS` lists every link.
fn links(
    link_ids: Option<Vec<Uuid>>,
    all_links: bool,
    mode: ReimportMode,
) -> Result<Option<Vec<Uuid>>, Report> {
    match (link_ids, all_links, mode) {
        (Some(_), true, _) => rootcause::bail!("set either LINK_IDS or ALL_LINKS=true, not both"),
        (Some(link_ids), false, _) => Ok(Some(link_ids)),
        (None, true, _) | (None, false, ReimportMode::Verify) => Ok(None),
        (None, false, ReimportMode::Apply) => rootcause::bail!(
            "nothing to re-import: set LINK_IDS to the links to re-import, in order, or ALL_LINKS=true for every Outlook link (VERIFY=true lists what a run would do)"
        ),
    }
}
