use super::*;
use crate::domain::models::{ImportStatus, RunStatus};
use crate::domain::ports::ImportError;
use crate::domain::service::test::admission::{Creator, NoConnector, Repo, user};
use crate::domain::service::{ImportService, ImportStager, gather_timeout};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

type Service<W = FakeSlackSource> = ImportServiceImpl<Repo, NoConnector, Creator, W>;

#[derive(Default)]
struct Workspace {
    conversations: Vec<SlackConversationPage>,
    users: Vec<SlackUserPage>,
    members: Vec<SlackMemberPage>,
    conversation_calls: Mutex<Vec<Option<String>>>,
    user_calls: Mutex<Vec<Option<String>>>,
    member_calls: Mutex<Vec<(String, Option<String>)>>,
    rate_limits: Mutex<HashMap<String, usize>>,
    directory_fails: bool,
    observe_staged: Option<Repo>,
    import_during_members: Option<Repo>,
}

#[derive(Clone, Default)]
struct FakeSession(Arc<Workspace>);

struct FakeSlackSource(FakeSession);

impl SlackWorkspaceSource for FakeSlackSource {
    type Session = FakeSession;

    async fn open(&self, _: &MacroUserIdStr<'static>) -> Result<FakeSession, SlackSourceError> {
        Ok(self.0.clone())
    }
}

fn page_index(cursor: Option<&str>) -> usize {
    cursor.map(|cursor| cursor.parse().unwrap()).unwrap_or(0)
}

impl SlackWorkspaceSession for FakeSession {
    async fn list_conversations(
        &self,
        cursor: Option<&str>,
    ) -> Result<SlackConversationPage, SlackSourceError> {
        self.0
            .conversation_calls
            .lock()
            .unwrap()
            .push(cursor.map(str::to_string));
        Ok(self
            .0
            .conversations
            .get(page_index(cursor))
            .cloned()
            .unwrap_or(SlackConversationPage {
                conversations: Vec::new(),
                next_cursor: None,
            }))
    }

    async fn list_users(&self, cursor: Option<&str>) -> Result<SlackUserPage, SlackSourceError> {
        self.0
            .user_calls
            .lock()
            .unwrap()
            .push(cursor.map(str::to_string));
        if let Some(repo) = &self.0.observe_staged {
            let rows = repo.list(&user(), None, None).await.unwrap();
            assert!(!rows.is_empty());
            assert!(
                rows.iter()
                    .all(|row| row.metadata["members_resolved"] == false)
            );
        }
        if self.0.directory_fails {
            return Err(SlackSourceError::MissingScope("users:read".into()));
        }
        Ok(self
            .0
            .users
            .get(page_index(cursor))
            .cloned()
            .unwrap_or(SlackUserPage {
                users: Vec::new(),
                next_cursor: None,
            }))
    }

    async fn conversation_members(
        &self,
        channel: &SlackConversationId,
        cursor: Option<&str>,
    ) -> Result<SlackMemberPage, SlackSourceError> {
        self.0
            .member_calls
            .lock()
            .unwrap()
            .push((channel.as_str().into(), cursor.map(str::to_string)));
        {
            let mut limits = self.0.rate_limits.lock().unwrap();
            if let Some(remaining) = limits.get_mut(channel.as_str())
                && *remaining > 0
            {
                *remaining -= 1;
                return Err(SlackSourceError::RateLimited {
                    retry_after: Some(Duration::ZERO),
                });
            }
        }
        if let Some(repo) = &self.0.import_during_members {
            let row = repo
                .get_own_by_foreign_id(&user(), ImportSource::Slack, channel.as_str())
                .await
                .unwrap()
                .unwrap();
            repo.mark_importing(&user(), &[row.id]).await.unwrap();
        }
        Ok(self
            .0
            .members
            .get(page_index(cursor))
            .cloned()
            .unwrap_or(SlackMemberPage {
                members: Vec::new(),
                next_cursor: None,
            }))
    }
}

fn channel(index: usize) -> SlackConversation {
    SlackConversation {
        id: SlackConversationId::new(&format!("C{index:010}")).unwrap(),
        name: format!("channel-{index}"),
        kind: SlackConversationKind::PublicChannel,
        archived: false,
        member_count: Some(index as u64),
        purpose: Some("Channel shape only".into()),
    }
}

fn slack_user(index: usize, email: Option<&str>) -> SlackUser {
    SlackUser {
        id: SlackUserId::new(&format!("U{index:010}")).unwrap(),
        display_name: format!("User {index}"),
        email: email.map(str::to_string),
        is_bot: false,
        deleted: false,
    }
}

fn workspace(channels: Vec<SlackConversation>) -> Workspace {
    Workspace {
        conversations: vec![SlackConversationPage {
            conversations: channels,
            next_cursor: None,
        }],
        ..Workspace::default()
    }
}

fn service(repo: Repo, workspace: Workspace) -> Service {
    ImportServiceImpl::new(
        repo,
        Arc::new(NoConnector),
        Arc::new(Creator::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_slack_source(Arc::new(FakeSlackSource(FakeSession(Arc::new(workspace)))))
}

fn cursors(count: usize) -> Vec<Option<String>> {
    (0..count)
        .map(|index| (index > 0).then(|| index.to_string()))
        .collect()
}

#[tokio::test]
async fn pagination_follows_cursors_and_stops_at_each_bound() {
    let workspace = Workspace {
        conversations: (0..12)
            .map(|index| SlackConversationPage {
                conversations: vec![channel(index)],
                next_cursor: Some((index + 1).to_string()),
            })
            .collect(),
        users: (0..12)
            .map(|index| SlackUserPage {
                users: vec![slack_user(index, None)],
                next_cursor: Some((index + 1).to_string()),
            })
            .collect(),
        members: (0..12)
            .map(|index| SlackMemberPage {
                members: vec![slack_user(index, None).id],
                next_cursor: Some((index + 1).to_string()),
            })
            .collect(),
        ..Workspace::default()
    };
    let service = service(Repo::default(), workspace);
    assert_eq!(
        gather_slack(&service, &user(), GatherMode::Manual)
            .await
            .unwrap(),
        MAX_CONVERSATION_PAGES
    );
    let calls = &service.slack_source.0.0;
    assert_eq!(
        *calls.conversation_calls.lock().unwrap(),
        cursors(MAX_CONVERSATION_PAGES)
    );
    assert_eq!(*calls.user_calls.lock().unwrap(), cursors(MAX_USER_PAGES));
    let members = calls.member_calls.lock().unwrap();
    assert_eq!(members.len(), MAX_CONVERSATION_PAGES * MAX_MEMBER_PAGES);
    for reads in members.chunks(MAX_MEMBER_PAGES) {
        assert_eq!(
            reads
                .iter()
                .map(|(_, cursor)| cursor.clone())
                .collect::<Vec<_>>(),
            cursors(MAX_MEMBER_PAGES)
        );
    }
}

#[tokio::test]
async fn onboarding_ranks_caps_and_excludes_archived_and_unsupported_kinds() {
    let mut channels: Vec<_> = (0..20).map(channel).collect();
    channels[19].archived = true;
    channels.push(channel(18)); // duplicate across the listing
    for (index, kind) in [
        SlackConversationKind::PrivateChannel,
        SlackConversationKind::DirectMessage,
        SlackConversationKind::GroupDirectMessage,
    ]
    .into_iter()
    .enumerate()
    {
        let mut unsupported = channel(30 + index);
        unsupported.kind = kind;
        channels.push(unsupported);
    }
    let repo = Repo::default();
    let service = service(
        repo.clone(),
        Workspace {
            observe_staged: Some(repo),
            ..workspace(channels)
        },
    );
    assert_eq!(
        gather_slack(&service, &user(), GatherMode::Onboarding)
            .await
            .unwrap(),
        15
    );
    let rows = service.repo.list(&user(), None, None).await.unwrap();
    assert_eq!(rows.len(), 15);
    assert_eq!(rows[0].foreign_id, channel(18).id.as_str());
    assert_eq!(rows[14].foreign_id, channel(4).id.as_str());
    assert!(
        rows.iter()
            .all(|row| row.initiator == Initiator::Onboarding && row.metadata["archived"] == false)
    );
    assert_eq!(
        service.slack_source.0.0.member_calls.lock().unwrap().len(),
        15
    );
}

#[tokio::test]
async fn manual_stages_all_public_channels_including_archived_but_bounds_enrichment() {
    let mut channels: Vec<_> = (0..102).map(channel).collect();
    channels[101].archived = true;
    channels.push(channel(101));
    for kind in [
        SlackConversationKind::PrivateChannel,
        SlackConversationKind::DirectMessage,
        SlackConversationKind::GroupDirectMessage,
    ] {
        let mut unsupported = channel(200);
        unsupported.kind = kind;
        channels.push(unsupported);
    }
    let service = service(Repo::default(), workspace(channels));
    assert_eq!(
        gather_slack(&service, &user(), GatherMode::Manual)
            .await
            .unwrap(),
        102
    );
    let rows = service.repo.list(&user(), None, None).await.unwrap();
    assert_eq!(rows.len(), 102);
    assert!(rows.iter().all(|row| row.initiator == Initiator::Manual));
    assert_eq!(rows[101].metadata["archived"], true);
    assert_eq!(rows[0].metadata["members_resolved"], false);
    assert_eq!(rows[1].metadata["members_resolved"], false);
    assert!(
        rows[2..]
            .iter()
            .all(|row| row.metadata["members_resolved"] == true)
    );
    let calls = service.slack_source.0.0.member_calls.lock().unwrap();
    assert_eq!(calls.len(), MANUAL_MEMBER_BUDGET);
    assert_eq!(calls[0].0, channel(101).id.as_str());
}

#[tokio::test]
async fn resolves_only_roster_matches_and_counts_all_known_humans() {
    let mut users = vec![
        slack_user(0, Some("IMPORT@EXAMPLE.COM")),
        slack_user(1, Some("outside@example.com")),
        slack_user(2, None),
        slack_user(3, Some("import@example.com")),
        slack_user(4, Some("import@example.com")),
    ];
    users[3].is_bot = true;
    users[4].deleted = true;
    let mut members: Vec<_> = users.iter().map(|user| user.id.clone()).collect();
    members.extend([users[0].id.clone(), slack_user(99, None).id]);
    let service = service(
        Repo::with_roster(vec![user()]),
        Workspace {
            users: vec![SlackUserPage {
                users,
                next_cursor: None,
            }],
            members: vec![SlackMemberPage {
                members,
                next_cursor: None,
            }],
            ..workspace(vec![channel(0)])
        },
    );
    gather_slack(&service, &user(), GatherMode::Manual)
        .await
        .unwrap();
    let rows = service.repo.list(&user(), None, None).await.unwrap();
    let metadata: SlackChannelMeta = serde_json::from_value(rows[0].metadata.clone()).unwrap();
    assert_eq!(metadata.member_count, Some(3));
    assert_eq!(
        metadata.participants,
        vec![SlackParticipant {
            name: "User 0".into(),
            email: Some("IMPORT@EXAMPLE.COM".into())
        }]
    );
    assert!(metadata.members_resolved);
}

#[tokio::test]
async fn rate_limited_channels_retry_once_and_persistent_errors_do_not_fail_gather() {
    let service = service(
        Repo::default(),
        Workspace {
            rate_limits: Mutex::new(HashMap::from([
                (channel(0).id.as_str().into(), 1),
                (channel(1).id.as_str().into(), 3),
            ])),
            ..workspace(vec![channel(0), channel(1), channel(2)])
        },
    );
    assert_eq!(
        gather_slack(&service, &user(), GatherMode::Manual)
            .await
            .unwrap(),
        3
    );
    let rows = service.repo.list(&user(), None, None).await.unwrap();
    assert_eq!(rows[0].metadata["members_resolved"], true);
    assert_eq!(rows[1].metadata["members_resolved"], false);
    assert_eq!(rows[2].metadata["members_resolved"], true);
    let calls = service.slack_source.0.0.member_calls.lock().unwrap();
    for index in 0..2 {
        assert_eq!(
            calls
                .iter()
                .filter(|(id, _)| id == channel(index).id.as_str())
                .count(),
            2
        );
    }
}

#[tokio::test]
async fn directory_failure_preserves_unresolved_candidates() {
    let service = service(
        Repo::default(),
        Workspace {
            directory_fails: true,
            ..workspace(vec![channel(0)])
        },
    );
    assert_eq!(
        gather_slack(&service, &user(), GatherMode::Manual)
            .await
            .unwrap(),
        1
    );
    let rows = service.repo.list(&user(), None, None).await.unwrap();
    assert_eq!(rows[0].metadata["members_resolved"], false);
    assert!(
        service
            .slack_source
            .0
            .0
            .member_calls
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn enrichment_does_not_overwrite_a_concurrent_import() {
    let repo = Repo::default();
    let service = service(
        repo.clone(),
        Workspace {
            import_during_members: Some(repo),
            ..workspace(vec![channel(0)])
        },
    );
    assert_eq!(
        gather_slack(&service, &user(), GatherMode::Manual)
            .await
            .unwrap(),
        1
    );
    let rows = service.repo.list(&user(), None, None).await.unwrap();
    assert_eq!(rows[0].status, ImportStatus::Importing);
    assert_eq!(rows[0].metadata["members_resolved"], false);
}

#[tokio::test]
async fn silent_staging_and_discovery_notifications_are_batched() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = service(Repo::default(), workspace((0..21).map(channel).collect()))
        .with_notifier(Arc::new({
            let calls = calls.clone();
            move |_| {
                calls.fetch_add(1, Ordering::SeqCst);
                Box::pin(async {})
            }
        }));
    service
        .stage_inner(
            &user(),
            Initiator::Manual,
            ImportSource::Slack,
            channel(0).id.as_str(),
            serde_json::json!({"name": "general"}),
            false,
        )
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    service
        .stage(
            &user(),
            Initiator::Manual,
            ImportSource::Slack,
            channel(0).id.as_str(),
            serde_json::json!({"name": "general"}),
        )
        .await
        .unwrap();
    assert_eq!(calls.swap(0, Ordering::SeqCst), 1);
    gather_slack(&service, &user(), GatherMode::Manual)
        .await
        .unwrap();
    // Two batches and a final notification for each of staging and enrichment.
    assert_eq!(calls.load(Ordering::SeqCst), 6);
}

async fn finished_run<W: SlackWorkspaceSource>(
    service: &Service<W>,
) -> crate::domain::models::ImportRun {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let run = service
                .repo
                .list_runs(&user())
                .await
                .unwrap()
                .pop()
                .unwrap();
            if run.status != RunStatus::Running {
                return run;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn manual_without_connection_fails_readably_without_loading_connector_tools() {
    let service =
        service(Repo::default(), Workspace::default()).with_slack_source(Arc::new(NoSlackSource));
    assert!(
        service
            .start_discovery(user(), ImportSource::Slack)
            .await
            .unwrap()
    );
    let run = finished_run(&service).await;
    assert_eq!(run.status, RunStatus::Failed);
    assert_eq!(run.error.as_deref(), Some("Slack is not connected"));
    assert!(!run.auto_import);
}

struct MissingTools;
impl SlackWorkspaceSource for MissingTools {
    type Session = NoSlackSession;
    async fn open(&self, _: &MacroUserIdStr<'static>) -> Result<NoSlackSession, SlackSourceError> {
        Err(SlackSourceError::ToolsUnavailable("members"))
    }
}

#[tokio::test]
async fn manual_without_tools_fails_readably() {
    let service =
        service(Repo::default(), Workspace::default()).with_slack_source(Arc::new(MissingTools));
    assert!(
        service
            .start_discovery(user(), ImportSource::Slack)
            .await
            .unwrap()
    );
    let run = finished_run(&service).await;
    assert_eq!(run.status, RunStatus::Failed);
    assert_eq!(
        run.error.as_deref(),
        Some("Your Slack connection does not expose channel tools")
    );
}

#[tokio::test]
async fn manual_rejects_other_sources_and_does_not_restart_running_runs() {
    let service = service(Repo::default(), Workspace::default());
    let error = service
        .start_discovery(user(), ImportSource::Linear)
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        ImportError::UnsupportedDiscovery(ImportSource::Linear)
    ));
    assert_eq!(
        error.to_string(),
        "manual discovery is not supported for linear"
    );
    service
        .repo
        .start_run(&user(), ImportSource::Slack, &[], true)
        .await
        .unwrap();
    assert!(
        !service
            .start_discovery(user(), ImportSource::Slack)
            .await
            .unwrap()
    );
    assert!(service.repo.list_runs(&user()).await.unwrap()[0].auto_import);
    assert!(
        service
            .slack_source
            .0
            .0
            .conversation_calls
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn manual_restarts_terminal_runs_without_auto_import() {
    for status in [
        RunStatus::Ready,
        RunStatus::Completed,
        RunStatus::Failed,
        RunStatus::Dismissed,
    ] {
        let service = service(Repo::default(), workspace(vec![channel(0)]));
        service
            .repo
            .start_run(&user(), ImportSource::Slack, &[], true)
            .await
            .unwrap();
        service
            .repo
            .finish_run(&user(), ImportSource::Slack, status, None)
            .await
            .unwrap();
        assert!(
            service
                .start_discovery(user(), ImportSource::Slack)
                .await
                .unwrap()
        );
        let run = finished_run(&service).await;
        assert_eq!(run.status, RunStatus::Ready);
        assert!(!run.auto_import);
    }
}

#[test]
fn gather_deadlines_depend_on_source_and_mode() {
    assert_eq!(
        gather_timeout(ImportSource::Slack, GatherMode::Onboarding),
        Duration::from_secs(180)
    );
    assert_eq!(
        gather_timeout(ImportSource::Slack, GatherMode::Manual),
        Duration::from_secs(360)
    );
    assert_eq!(
        gather_timeout(ImportSource::Notion, GatherMode::Onboarding),
        Duration::from_secs(90)
    );
}
