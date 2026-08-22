use std::sync::Arc;

use anyhow::Context;
use channels::{domain::service::ChannelServiceImpl, outbound::pg_channels_repo::PgChannelsRepo};
use database_env_vars::DatabaseUrl;
use macro_entrypoint::MacroEntrypoint;
use notification::domain::{
    models::{Notification, NotificationResult, SendNotificationRequest},
    service::{NotificationIngress, SendNotificationError},
};
use roles_and_permissions::{
    domain::service::UserRolesAndPermissionsServiceImpl, outbound::pgpool::MacroDB,
};
use sqlx::postgres::PgPoolOptions;
use teams::{
    domain::{
        crm_enqueuer::NoOpCrmEnqueuer, model::BackfillTeammateDmsPage,
        team_crm_settings_repo::NoOpTeamCrmSettingsRepository, team_repo::TeamService,
        team_service::TeamServiceImpl,
    },
    outbound::{customer_repo::CustomerRepositoryImpl, team_repo::TeamRepositoryImpl},
};

const PAGE_SIZE: u32 = 100;

#[derive(Clone)]
struct NoOpNotificationIngress;

impl NotificationIngress for NoOpNotificationIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &'a self,
        _req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, rootcause::Report<SendNotificationError>> {
        Ok(None)
    }
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

    let roles_db = MacroDB::new(db.clone());
    let team_service = TeamServiceImpl::new(
        TeamRepositoryImpl::new(db.clone()),
        CustomerRepositoryImpl::new(stripe::Client::new("unused"), "unused".to_string()),
        ChannelServiceImpl::new(PgChannelsRepo::new(db)),
        UserRolesAndPermissionsServiceImpl::new(roles_db.clone(), roles_db),
        Arc::new(NoOpNotificationIngress),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let mut cursor = None;
    let mut total = BackfillTeammateDmsPage::default();
    loop {
        let page = team_service
            .backfill_teammate_dms(cursor, PAGE_SIZE)
            .await?;
        println!(
            "teams_processed={} created={} existing={} failed={}",
            page.teams_processed, page.created, page.existing, page.failed
        );
        total.teams_processed += page.teams_processed;
        total.created += page.created;
        total.existing += page.existing;
        total.failed += page.failed;

        let Some(next_team_id) = page.next_team_id else {
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
