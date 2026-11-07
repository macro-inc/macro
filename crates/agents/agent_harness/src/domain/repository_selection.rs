//! Selection policy for hosted coding sessions, limited to reachable repositories.

use agent_session::domain::model::AgentSession;
use cursor_cloud_agents::domain::model::RepoUrl;
use cursor_cloud_agents::domain::ports::SessionIntent;

#[cfg(test)]
mod test;

/// The newest session repository that is still reachable, using the listing's URL.
pub(crate) fn recent_repository<'a>(
    candidates: &'a [String],
    recent: &[AgentSession],
) -> Option<&'a str> {
    recent.iter().find_map(|session| {
        let url = RepoUrl::parse(session.repo_url.as_deref()?)?;
        candidates
            .iter()
            .find(|candidate| {
                RepoUrl::parse(candidate)
                    .is_some_and(|candidate| candidate.as_str().eq_ignore_ascii_case(url.as_str()))
            })
            .map(String::as_str)
    })
}

/// Every hosted coding session must have an accessible repository.
/// Prefer the newest accessible repository; first-time users get the first candidate.
pub(crate) fn fallback_repository<'a>(
    candidates: &'a [String],
    recent: &[AgentSession],
) -> Result<&'a str, rootcause::Report> {
    recent_repository(candidates, recent)
        .or_else(|| candidates.first().map(String::as_str))
        .ok_or_else(|| rootcause::report!("Connect GitHub and grant Macro access to a repository before starting a coding session"))
}

/// Validate a model choice against the owner's reachable repositories.
pub(crate) fn intent(
    candidates: &[String],
    chosen: &str,
) -> Result<SessionIntent, rootcause::Report> {
    if !candidates.iter().any(|candidate| candidate == chosen) {
        return Err(rootcause::report!(
            "chose {chosen}, which is not one of this user's repositories"
        ));
    }
    let repository = RepoUrl::parse(chosen)
        .ok_or_else(|| rootcause::report!("chose {chosen}, which is not a repository url"))?;
    Ok(SessionIntent {
        repository: Some(repository),
        open_pull_request: true,
    })
}
