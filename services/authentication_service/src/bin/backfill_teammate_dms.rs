use std::collections::HashSet;

use anyhow::Context;
use channels::{
    domain::{dm::ensure_dms_for_roster, ports::ChannelService, service::ChannelServiceImpl},
    outbound::pg_channels_repo::PgChannelsRepo,
};
use database_env_vars::DatabaseUrl;
use macro_entrypoint::MacroEntrypoint;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::postgres::PgPoolOptions;
use teams::{domain::team_repo::TeamRepository, outbound::team_repo::TeamRepositoryImpl};

const PAGE_SIZE: u32 = 100;

#[derive(Default)]
struct Progress {
    created: usize,
    existing: usize,
    failed: usize,
    teams_processed: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let database_url = DatabaseUrl::new().context("DATABASE_URL must be provided")?;
    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(database_url.as_ref())
        .await
        .context("could not connect to db")?;

    let team_repo = TeamRepositoryImpl::new(db.clone());
    let channels = ChannelServiceImpl::new(PgChannelsRepo::new(db));

    let mut cursor = None;
    let mut total = Progress::default();
    loop {
        let team_ids = team_repo.list_team_ids_after(cursor, PAGE_SIZE).await?;
        let next_team_id = if team_ids.len() == PAGE_SIZE as usize {
            team_ids.last().copied()
        } else {
            None
        };

        for team_id in team_ids {
            total.teams_processed += 1;
            let team_with_members = match team_repo.get_team_by_id(&team_id).await {
                Ok(team_with_members) => team_with_members,
                Err(error) => {
                    total.failed += 1;
                    tracing::error!(
                        error=?error,
                        %team_id,
                        "failed to load team roster for teammate direct-message backfill"
                    );
                    continue;
                }
            };
            let owner = MacroUserIdStr::try_from(team_with_members.team.owner_id().to_string())
                .context("team owner id is invalid")?;
            let roster = std::iter::once(owner)
                .chain(
                    team_with_members
                        .members
                        .into_iter()
                        .map(|member| member.user_id),
                )
                .collect::<HashSet<_>>();
            match channels.ensure_dms(ensure_dms_for_roster(roster)).await {
                Ok(summary) => {
                    total.created += summary.created;
                    total.existing += summary.existing;
                    total.failed += summary.failed;
                    println!(
                        "team={team_id} created={} existing={} failed={}",
                        summary.created, summary.existing, summary.failed
                    );
                }
                Err(error) => {
                    total.failed += 1;
                    tracing::error!(
                        error=?error,
                        %team_id,
                        "failed to ensure teammate direct messages during backfill"
                    );
                }
            }
        }

        let Some(next_team_id) = next_team_id else {
            break;
        };
        cursor = Some(next_team_id);
    }

    println!(
        "total teams_processed={} created={} existing={} failed={}",
        total.teams_processed, total.created, total.existing, total.failed
    );
    if total.failed > 0 {
        anyhow::bail!("teammate direct-message backfill completed with failures");
    }

    Ok(())
}
