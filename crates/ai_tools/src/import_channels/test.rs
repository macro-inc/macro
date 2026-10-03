//! Cross-domain composition tests: real reservations, onboarding ledger and channel persistence.

use channels::{
    domain::{
        historical::{HistoricalChannel, HistoricalChannelKind},
        models::GetChannelsRequest,
        ports::{ChannelListRepo, HistoricalChannelRepo},
        service::ChannelServiceImpl,
    },
    outbound::pg_channels_repo::PgChannelsRepo,
};
use import::{
    domain::{
        models::{
            ImportEntity, ImportSource, ImportStatus, ImportTargetKey, ImportTargetKind,
            ImportTargetReservation, Initiator, SlackConversationId,
        },
        ports::{
            CanonicalImportRepo, EntityCreator, ImportRepo, ImportedDocumentProperties,
            ImportedTaskProperties,
        },
        service::{ImportService, ImportServiceImpl},
    },
    outbound::pg_import_repo::PgImportRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::{ConnectorRef, ConnectorSelect, UserMcpTools};
use models_pagination::{Query, SimpleSortMethod};
use std::{
    collections::HashSet,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use uuid::Uuid;

struct NoConnectors;

impl ConnectorSelect for NoConnectors {
    async fn user_toolset(&self, _: &MacroUserIdStr<'static>) -> UserMcpTools {
        unreachable!("deterministic Slack imports never invoke MCP")
    }
    async fn connector_toolset(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ConnectorRef<'_>,
    ) -> anyhow::Result<Option<UserMcpTools>> {
        unreachable!("deterministic Slack imports never invoke MCP")
    }
    async fn connector_connected(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ConnectorRef<'_>,
    ) -> anyhow::Result<bool> {
        unreachable!("deterministic Slack imports never invoke MCP")
    }
}

struct ReservedCreator {
    service: ChannelServiceImpl<PgChannelsRepo>,
    lose_response: AtomicBool,
}

impl EntityCreator for ReservedCreator {
    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedTaskProperties,
    ) -> anyhow::Result<String> {
        unreachable!()
    }
    async fn create_markdown_doc(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedDocumentProperties,
    ) -> anyhow::Result<String> {
        unreachable!()
    }
    async fn create_channel(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        target: &ImportTargetReservation,
        _: &[String],
    ) -> anyhow::Result<Uuid> {
        let persisted = self
            .service
            .create_reserved_team_channel(
                user.clone(),
                target.channel_id,
                target.key.team_id,
                name.to_string(),
                HashSet::new(),
            )
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        anyhow::ensure!(
            !self.lose_response.swap(false, Ordering::SeqCst),
            "lost creation response"
        );
        Ok(persisted.id)
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|left-user@test.com".to_string()).unwrap()
}

fn key() -> ImportTargetKey {
    ImportTargetKey {
        team_id: Uuid::from_u128(0x11111111_1111_1111_1111_111111111111),
        foreign_id: SlackConversationId::new("C0123456789").unwrap(),
    }
}

async fn stage(repo: &PgImportRepo) -> ImportEntity {
    repo.upsert_staged(
        &user(),
        ImportSource::Slack,
        Initiator::Onboarding,
        key().foreign_id.as_str(),
        &serde_json::json!({"name": "engineering", "channel_id": key().foreign_id.as_str()}),
    )
    .await
    .unwrap()
    .unwrap()
}

async fn settled(repo: &PgImportRepo, id: Uuid) -> ImportEntity {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let row = repo.get(&user(), id).await.unwrap().unwrap();
            if row.status != ImportStatus::Importing {
                return row;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("onboarding should settle")
}

async fn channel_count(repo: &PgChannelsRepo) -> usize {
    repo.get_user_channels_with_participants(
        GetChannelsRequest {
            macro_id: user(),
            limit: Some(100),
            include_frecency: false,
            query: Query::Sort(SimpleSortMethod::UpdatedAt, None),
        }
        .into_params(),
    )
    .await
    .unwrap()
    .len()
}

async fn archive(repo: &PgImportRepo, channels: &PgChannelsRepo) -> Uuid {
    let admin = MacroUserIdStr::try_from("macro|team-owner-a@test.com".to_string()).unwrap();
    let target = repo
        .reserve_target(&admin, &key(), ImportTargetKind::Team, None)
        .await
        .unwrap();
    let persisted = channels
        .create_historical_channel(&HistoricalChannel {
            id: target.channel_id,
            name: "archive name".to_string(),
            kind: HistoricalChannelKind::Team(key().team_id),
            owner: admin,
            participants: HashSet::from([user()]),
            created_at: chrono::DateTime::from_timestamp(1_000, 0).unwrap(),
        })
        .await
        .unwrap();
    repo.complete_target(&key(), persisted.id, ImportTargetKind::Team)
        .await
        .unwrap()
        .channel_id
}

#[sqlx::test(
    migrations = "../macro_db_client/migrations",
    fixtures(path = "../../../channels/fixtures", scripts("channels_repo"))
)]
async fn concurrent_onboarding_and_archive_publish_one_canonical_ledger_target(pool: sqlx::PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let channels = PgChannelsRepo::new(pool);
    let before = channel_count(&channels).await;
    let row = stage(&repo).await;
    let service = ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnectors),
        Arc::new(ReservedCreator {
            service: ChannelServiceImpl::new(channels.clone()),
            lose_response: AtomicBool::new(false),
        }),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    let (run, archived) = tokio::join!(
        service.run_import(user(), vec![row.id], vec![]),
        archive(&repo, &channels),
    );
    assert_eq!(run.unwrap().importing, 1);
    let row = settled(&repo, row.id).await;
    assert_eq!(row.status, ImportStatus::Imported);
    assert_eq!(row.entity_id, Some(archived.to_string()));
    assert_eq!(row.team_id, Some(key().team_id));
    let canonical = repo
        .reserve_target(&user(), &key(), ImportTargetKind::Team, None)
        .await
        .unwrap();
    assert!(canonical.ready);
    assert_eq!(canonical.channel_id, archived);
    assert_eq!(channel_count(&channels).await, before + 1);
}

#[sqlx::test(
    migrations = "../macro_db_client/migrations",
    fixtures(path = "../../../channels/fixtures", scripts("channels_repo"))
)]
async fn onboarding_crash_retry_completes_the_original_reserved_channel(pool: sqlx::PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let channels = PgChannelsRepo::new(pool);
    let before = channel_count(&channels).await;
    let row = stage(&repo).await;
    let service = ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnectors),
        Arc::new(ReservedCreator {
            service: ChannelServiceImpl::new(channels.clone()),
            lose_response: AtomicBool::new(true),
        }),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    service
        .run_import(user(), vec![row.id], vec![])
        .await
        .unwrap();
    let failed = settled(&repo, row.id).await;
    assert_eq!(failed.status, ImportStatus::Staged);
    assert!(
        failed
            .last_error
            .unwrap()
            .contains("lost creation response")
    );
    let pending = repo
        .reserve_target(&user(), &key(), ImportTargetKind::Team, None)
        .await
        .unwrap();
    assert!(!pending.ready);
    assert_eq!(channel_count(&channels).await, before + 1);
    service
        .run_import(user(), vec![row.id], vec![])
        .await
        .unwrap();
    let imported = settled(&repo, row.id).await;
    assert_eq!(imported.status, ImportStatus::Imported);
    assert_eq!(imported.entity_id, Some(pending.channel_id.to_string()));
    assert_eq!(archive(&repo, &channels).await, pending.channel_id);
    assert_eq!(channel_count(&channels).await, before + 1);
}
