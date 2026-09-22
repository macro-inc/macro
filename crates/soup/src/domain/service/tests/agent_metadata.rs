use super::*;
use agent_changes::domain::{
    model::{AgentSessionId, CapturedBranch},
    ports::{SessionBranchReader, SessionBranchesFuture},
};
use models_soup::agent_session::{AgentPullRequestState, SoupAgentSession};

#[derive(Default)]
struct Branches {
    calls: Mutex<Vec<Vec<AgentSessionId>>>,
    branches: HashMap<AgentSessionId, CapturedBranch>,
}

impl SessionBranchReader for Branches {
    fn working_branches<'a>(&'a self, sessions: &'a [AgentSessionId]) -> SessionBranchesFuture<'a> {
        self.calls.lock().unwrap().push(sessions.to_vec());
        Box::pin(async { Ok(self.branches.clone()) })
    }
}

fn agent(id: AgentSessionId, pull_request: Option<&str>) -> SoupCandidate {
    SoupCandidate::plain(SoupItem::AgentSession(SoupAgentSession {
        id: id.as_uuid(),
        name: "Agent".to_owned(),
        owner_id: Owner::User(MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()),
        bot_id: Uuid::now_v7(),
        harness: "macrod".to_owned(),
        repo_url: Some("https://github.com/macro/macro".to_owned()),
        repo_branch: Some("main".to_owned()),
        pull_request_url: pull_request.map(str::to_owned),
        working_branch: None,
        pull_request_state: None,
        pull_request_id: None,
        turn_state: None,
        thread_id: None,
        status: "session/end".to_owned(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        viewed_at: None,
        extra: (),
    }))
}

fn pull_request(id: &str, user: &str, status: &str) -> ForeignEntity {
    ForeignEntity {
        id: Uuid::now_v7(),
        foreign_entity_id: format!("macro/macro/pull/{id}"),
        foreign_entity_source: "github_pull_request".to_owned(),
        metadata: serde_json::json!({ "status": status }),
        stored_for_id: user.to_owned(),
        stored_for_auth_entity: "user".to_owned(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[tokio::test]
async fn metadata_is_batched_and_only_uses_visible_prs_and_captured_branches() {
    let user = "macro|owner@example.com";
    let first = AgentSessionId::new();
    let second = AgentSessionId::new();
    let third = AgentSessionId::new();
    let branches = Branches {
        branches: HashMap::from([(
            first,
            CapturedBranch {
                repository_url: "https://github.com/macro/macro".to_owned(),
                branch: "agent/fix-icons".to_owned(),
            },
        )]),
        ..Default::default()
    };
    let foreign = RecordingForeignEntityService::new(vec![
        pull_request("1", user, "merged"),
        pull_request("2", "macro|someone-else@example.com", "closed"),
        pull_request("3", user, "unknown"),
    ]);
    let mut items = vec![
        agent(first, Some("https://github.com/macro/macro/pull/1/files")),
        agent(second, Some("https://github.com/macro/macro/pull/2")),
        agent(third, Some("https://github.com/macro/macro/pull/3")),
    ];
    super::super::agent_metadata::enrich(
        &foreign,
        Some(&branches),
        user.to_owned(),
        vec![SourceId::user(user)],
        &mut items,
    )
    .await
    .unwrap();

    let sessions: Vec<_> = items
        .iter()
        .map(|item| match &item.item {
            SoupItem::AgentSession(session) => session,
            _ => unreachable!(),
        })
        .collect();
    assert_eq!(
        sessions[0].working_branch.as_deref(),
        Some("agent/fix-icons")
    );
    assert_eq!(
        sessions[0].pull_request_state,
        Some(AgentPullRequestState::Merged)
    );
    assert_eq!(
        sessions[1].working_branch, None,
        "never substitute base main"
    );
    assert_eq!(
        sessions[1].pull_request_state, None,
        "another user's PR is hidden"
    );
    assert_eq!(sessions[1].pull_request_id, None);
    assert!(sessions[0].pull_request_id.is_some());
    assert!(sessions[2].pull_request_id.is_some());
    assert_eq!(sessions[2].pull_request_state, None, "unknown is not open");
    assert_eq!(
        *branches.calls.lock().unwrap(),
        vec![vec![first, second, third]]
    );
    let calls = foreign.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].limit, 3);
    assert_eq!(calls[0].source_ids, vec![SourceId::user(user)]);
}

#[tokio::test]
async fn no_pr_links_skip_foreign_entity_lookup() {
    let branches = Branches::default();
    let foreign = RecordingForeignEntityService::new(Vec::new());
    let mut items = vec![agent(AgentSessionId::new(), None)];
    super::super::agent_metadata::enrich(
        &foreign,
        Some(&branches),
        "macro|owner@example.com".to_owned(),
        vec![SourceId::user("macro|owner@example.com")],
        &mut items,
    )
    .await
    .unwrap();
    assert!(foreign.calls().is_empty());
    assert_eq!(branches.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn runtime_branch_without_pr_survives_enrichment_and_takes_precedence() {
    let session = AgentSessionId::new();
    let branches = Branches {
        branches: HashMap::from([(
            session,
            CapturedBranch {
                repository_url: "https://github.com/macro/macro".to_owned(),
                branch: "old-pr-branch".to_owned(),
            },
        )]),
        ..Default::default()
    };
    let foreign = RecordingForeignEntityService::new(Vec::new());
    let mut item = agent(session, None);
    let SoupItem::AgentSession(row) = &mut item.item else {
        unreachable!()
    };
    row.working_branch = Some("cursor/no-pr".to_owned());
    let mut items = vec![item];
    super::super::agent_metadata::enrich(
        &foreign,
        Some(&branches),
        "macro|owner@example.com".to_owned(),
        vec![SourceId::user("macro|owner@example.com")],
        &mut items,
    )
    .await
    .unwrap();
    let SoupItem::AgentSession(row) = &items[0].item else {
        unreachable!()
    };
    assert_eq!(row.working_branch.as_deref(), Some("cursor/no-pr"));
    assert_eq!(row.pull_request_url, None);
    assert!(branches.calls.lock().unwrap().is_empty());
    assert!(foreign.calls().is_empty());
}

#[tokio::test]
async fn changed_or_missing_repository_does_not_restore_an_old_captured_branch() {
    for repository in [Some("https://github.com/macro/replacement"), None] {
        let session = AgentSessionId::new();
        let branches = Branches {
            branches: HashMap::from([(
                session,
                CapturedBranch {
                    repository_url: "https://github.com/macro/macro".to_owned(),
                    branch: "old-pr-branch".to_owned(),
                },
            )]),
            ..Default::default()
        };
        let foreign = RecordingForeignEntityService::new(Vec::new());
        let mut item = agent(session, None);
        let SoupItem::AgentSession(row) = &mut item.item else {
            unreachable!()
        };
        row.repo_url = repository.map(str::to_owned);
        let mut items = vec![item];
        super::super::agent_metadata::enrich(
            &foreign,
            Some(&branches),
            "macro|owner@example.com".to_owned(),
            vec![SourceId::user("macro|owner@example.com")],
            &mut items,
        )
        .await
        .unwrap();
        let SoupItem::AgentSession(row) = &items[0].item else {
            unreachable!()
        };
        assert_eq!(row.working_branch, None);
    }
}
