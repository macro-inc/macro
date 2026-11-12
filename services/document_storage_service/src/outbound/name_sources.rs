//! Name sources for `POST /search/names` over the kinds this service hosts:
//! people, folders, initiatives, databases, agents, email labels, tags and
//! channel labels. Each reads through its owning domain service, with the
//! same access that domain's own list or search applies; search_service
//! serves channels, documents and tasks itself.

use search_service::names::{NameSourceError, Needle};

pub mod agents;
pub mod channel_labels;
pub mod databases;
pub mod email_labels;
pub mod folders;
pub mod initiatives;
pub mod people;
pub mod tags;

#[cfg(test)]
mod test;

/// Whether `name`, compared the way the lookup compares names (trimmed,
/// without one leading `#` or `@`, space collapsed, lowercase), contains one
/// of `needles`. Sources that list everything the viewer can access keep only
/// these; the lookup ranks them.
fn contains_any(name: &str, needles: &[Needle]) -> bool {
    let Some(name) = Needle::parse(name) else {
        return false;
    };
    needles
        .iter()
        .any(|needle| name.as_str().contains(needle.as_str()))
}

/// A domain service's failure, as the lookup reports it.
fn internal<E>(error: E) -> NameSourceError
where
    E: std::error::Error + Send + Sync + 'static,
{
    NameSourceError::Internal(rootcause::Report::new(error).into_dynamic())
}
