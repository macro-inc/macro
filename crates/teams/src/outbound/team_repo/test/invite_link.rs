use uuid::Uuid;

use super::*;
use crate::domain::model::{TeamInviteLinkTeam, TeamInviteLinkToken};

const TEAM_1: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const TEAM_2: Uuid = Uuid::from_u128(0x22222222_2222_2222_2222_222222222222);

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("teams"))
)]
async fn invite_links_are_set_reset_and_turned_off_per_team(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    assert_eq!(team_repo.get_team_invite_link(&TEAM_1).await?, None);

    let first = TeamInviteLinkToken::generate();
    team_repo.set_team_invite_link(&TEAM_1, &first).await?;
    assert_eq!(team_repo.get_team_invite_link(&TEAM_1).await?, Some(first));
    assert_eq!(
        team_repo.get_team_by_invite_link(&first).await?,
        Some(TeamInviteLinkTeam {
            team_id: TEAM_1,
            team_name: "team1".to_string(),
        })
    );

    // Resetting replaces the token, so the old link stops resolving.
    let reset = TeamInviteLinkToken::generate();
    team_repo.set_team_invite_link(&TEAM_1, &reset).await?;
    assert_eq!(team_repo.get_team_invite_link(&TEAM_1).await?, Some(reset));
    assert_eq!(team_repo.get_team_by_invite_link(&first).await?, None);

    // Another team's link is independent.
    let other = TeamInviteLinkToken::generate();
    team_repo.set_team_invite_link(&TEAM_2, &other).await?;

    team_repo.delete_team_invite_link(&TEAM_1).await?;
    assert_eq!(team_repo.get_team_invite_link(&TEAM_1).await?, None);
    assert_eq!(team_repo.get_team_by_invite_link(&reset).await?, None);
    assert_eq!(team_repo.get_team_invite_link(&TEAM_2).await?, Some(other));

    // Turning off a team with no link is a no-op.
    team_repo.delete_team_invite_link(&TEAM_1).await?;

    Ok(())
}
