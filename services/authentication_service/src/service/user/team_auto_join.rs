use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::team_repo::TeamService;

/// Adds a user to the team whose auto-join domain matches their email domain.
/// Logs the outcome; never fails the caller.
pub async fn join_team_by_email_domain(teams_service: &impl TeamService, user_id: &str) {
    let user_id = match MacroUserIdStr::parse_from_str(user_id) {
        Ok(user_id) => user_id,
        Err(e) => {
            tracing::error!(error=?e, "unable to parse user id for team auto-join");
            return;
        }
    };
    match teams_service.try_join_team_by_domain(&user_id).await {
        Ok(Some(member)) => {
            tracing::info!(team_id=%member.team_id, "auto-joined user to team by email domain");
        }
        Ok(None) => {
            tracing::info!("no team auto-join domain matched the user's email domain");
        }
        Err(e) => {
            tracing::error!(error=?e, "failed to auto-join user to team by email domain");
        }
    }
}
