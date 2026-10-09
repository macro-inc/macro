use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Mutex;

use super::*;

#[derive(Default)]
struct StubLinks {
    links: Mutex<
        Vec<(
            AgentSessionId,
            String,
            PullRequestLinkSource,
            Option<String>,
        )>,
    >,
}

impl StubLinks {
    fn with_agent_link(session: AgentSessionId, github_key: &str) -> Self {
        let links = Self::default();
        links.links.lock().unwrap().push((
            session,
            github_key.to_owned(),
            PullRequestLinkSource::Agent,
            None,
        ));
        links
    }
}

impl SessionPullRequestLinkRepo for Arc<StubLinks> {
    async fn link_pull_request(
        &self,
        session: AgentSessionId,
        github_key: &str,
        linked_by: &MacroUserIdStr<'static>,
    ) -> Result<()> {
        let mut links = self.links.lock().unwrap();
        if !links
            .iter()
            .any(|(linked, key, ..)| *linked == session && key.eq_ignore_ascii_case(github_key))
        {
            links.push((
                session,
                github_key.to_owned(),
                PullRequestLinkSource::User,
                Some(linked_by.as_ref().to_owned()),
            ));
        }
        Ok(())
    }

    async fn unlink_pull_request(&self, session: AgentSessionId, github_key: &str) -> Result<bool> {
        let mut links = self.links.lock().unwrap();
        let before = links.len();
        links.retain(|(linked, key, source, _)| {
            !(*linked == session
                && key.eq_ignore_ascii_case(github_key)
                && *source == PullRequestLinkSource::User)
        });
        Ok(links.len() != before)
    }

    async fn session_pull_requests(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<SessionPullRequestLink>> {
        Ok(self
            .links
            .lock()
            .unwrap()
            .iter()
            .filter(|(linked, ..)| *linked == session)
            .map(|(_, key, source, linked_by)| SessionPullRequestLink {
                github_key: key.clone(),
                url: format!("https://github.com/{key}"),
                source: *source,
                linked_by: linked_by.clone(),
                created_at: DateTime::<Utc>::default(),
            })
            .collect())
    }

    async fn sessions_for_pull_request(&self, github_key: &str) -> Result<Vec<AgentSessionId>> {
        Ok(self
            .links
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, key, ..)| key.eq_ignore_ascii_case(github_key))
            .map(|(session, ..)| *session)
            .collect())
    }

    async fn links_for_pull_requests(
        &self,
        github_keys: &[String],
    ) -> Result<Vec<PullRequestSessionLinkRow>> {
        Ok(self
            .links
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, key, ..)| {
                github_keys
                    .iter()
                    .any(|requested| requested.eq_ignore_ascii_case(key))
            })
            .map(|(session, key, source, _)| PullRequestSessionLinkRow {
                github_key: key.clone(),
                session: *session,
                source: *source,
                thread_parent: Some(MessageParent::Channel(session.as_uuid())),
            })
            .collect())
    }
}

struct ViewableSessions(HashSet<AgentSessionId>);

impl SessionViewAccess for ViewableSessions {
    fn can_view<'a>(
        &'a self,
        _viewer: &'a MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> Pin<Box<dyn Future<Output = Result<bool>> + Send + 'a>> {
        Box::pin(async move { Ok(self.0.contains(&session)) })
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("linker@example.com").unwrap()
}

fn edit_access(session: AgentSessionId) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(),
        &session.to_string(),
        EntityType::AgentSession,
    )
}

fn view_access(session: AgentSessionId) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(),
        &session.to_string(),
        EntityType::AgentSession,
    )
}

fn service(
    links: &Arc<StubLinks>,
    viewable: &[AgentSessionId],
) -> SessionPullRequestLinkService<Arc<StubLinks>> {
    SessionPullRequestLinkService::new(
        links.clone(),
        Arc::new(ViewableSessions(viewable.iter().copied().collect())),
    )
}

#[tokio::test]
async fn links_a_pull_request_by_its_canonical_key_on_behalf_of_the_caller() {
    let session = AgentSessionId::new();
    let links = Arc::new(StubLinks::default());
    let service = service(&links, &[]);

    service
        .link_pull_request(
            &edit_access(session),
            "https://github.com/macro-inc/macro/pull/12/files?diff=split",
        )
        .await
        .unwrap_err();
    service
        .link_pull_request(
            &edit_access(session),
            "https://github.com/macro-inc/macro/pull/12#discussion",
        )
        .await
        .unwrap();
    service
        .link_pull_request(
            &edit_access(session),
            "https://github.com/macro-inc/macro/pull/12",
        )
        .await
        .unwrap();

    let linked = service
        .session_pull_requests(&view_access(session))
        .await
        .unwrap();
    assert_eq!(linked.len(), 1);
    assert_eq!(linked[0].github_key, "macro-inc/macro/pull/12");
    assert_eq!(linked[0].source, PullRequestLinkSource::User);
    assert_eq!(linked[0].linked_by.as_deref(), Some(user().as_ref()));
}

#[tokio::test]
async fn rejects_links_that_are_not_github_pull_requests() {
    let session = AgentSessionId::new();
    let links = Arc::new(StubLinks::default());
    let service = service(&links, &[]);

    let result = service
        .link_pull_request(
            &edit_access(session),
            "https://github.com/macro-inc/macro/issues/12",
        )
        .await;

    assert!(matches!(
        result,
        Err(AgentSessionError::InvalidPullRequestUrl)
    ));
}

#[tokio::test]
async fn unlinking_keeps_the_pull_request_the_agent_opened() {
    let session = AgentSessionId::new();
    let links = Arc::new(StubLinks::with_agent_link(
        session,
        "macro-inc/macro/pull/1",
    ));
    let service = service(&links, &[]);
    service
        .link_pull_request(
            &edit_access(session),
            "https://github.com/macro-inc/macro/pull/2",
        )
        .await
        .unwrap();

    for url in [
        "https://github.com/macro-inc/macro/pull/1",
        "https://github.com/macro-inc/macro/pull/2",
    ] {
        service
            .unlink_pull_request(&edit_access(session), url)
            .await
            .unwrap();
    }

    let linked = service
        .session_pull_requests(&view_access(session))
        .await
        .unwrap();
    assert_eq!(linked.len(), 1);
    assert_eq!(linked[0].github_key, "macro-inc/macro/pull/1");
    assert_eq!(linked[0].source, PullRequestLinkSource::Agent);
}

#[tokio::test]
async fn sessions_for_a_pull_request_are_the_linked_ones_the_viewer_can_view() {
    let visible = AgentSessionId::new();
    let hidden = AgentSessionId::new();
    let unrelated = AgentSessionId::new();
    let links = Arc::new(StubLinks::with_agent_link(
        visible,
        "Macro-Inc/Macro/pull/7",
    ));
    links.links.lock().unwrap().extend([
        (
            hidden,
            "macro-inc/macro/pull/7".to_owned(),
            PullRequestLinkSource::User,
            None,
        ),
        (
            unrelated,
            "macro-inc/macro/pull/8".to_owned(),
            PullRequestLinkSource::User,
            None,
        ),
    ]);
    let service = service(&links, &[visible, unrelated]);

    let sessions = service
        .sessions_for_pull_request(&user(), "https://github.com/macro-inc/macro/pull/7")
        .await
        .unwrap();

    assert_eq!(sessions, vec![visible]);
}

#[tokio::test]
async fn sessions_for_pull_requests_answers_each_requested_pull_request_in_order() {
    let visible = AgentSessionId::new();
    let hidden = AgentSessionId::new();
    let links = Arc::new(StubLinks::with_agent_link(
        visible,
        "Macro-Inc/Macro/pull/7",
    ));
    links.links.lock().unwrap().extend([
        (
            visible,
            "macro-inc/macro/pull/9".to_owned(),
            PullRequestLinkSource::User,
            None,
        ),
        (
            hidden,
            "macro-inc/macro/pull/9".to_owned(),
            PullRequestLinkSource::User,
            None,
        ),
    ]);
    let service = service(&links, &[visible]);

    let pull_requests = service
        .sessions_for_pull_requests(
            &user(),
            &[
                "https://github.com/macro-inc/macro/pull/9".to_owned(),
                "https://github.com/macro-inc/macro/pull/8".to_owned(),
                "https://github.com/macro-inc/macro/pull/7#discussion".to_owned(),
            ],
        )
        .await
        .unwrap();

    let summary: Vec<_> = pull_requests
        .iter()
        .map(|pull_request| {
            (
                pull_request.github_key.as_str(),
                pull_request
                    .sessions
                    .iter()
                    .map(|session| (session.session_id, session.source))
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (
                "macro-inc/macro/pull/9",
                vec![(visible.as_uuid(), PullRequestLinkSource::User)]
            ),
            ("macro-inc/macro/pull/8", vec![]),
            (
                "macro-inc/macro/pull/7",
                vec![(visible.as_uuid(), PullRequestLinkSource::Agent)]
            ),
        ]
    );
    assert_eq!(
        pull_requests[0].sessions[0].thread_parent,
        Some(MessageParent::Channel(visible.as_uuid()))
    );
}

#[tokio::test]
async fn sessions_for_pull_requests_rejects_oversized_and_invalid_requests() {
    let links = Arc::new(StubLinks::default());
    let service = service(&links, &[]);

    let too_many: Vec<_> = (1..=MAX_PULL_REQUESTS_PER_LOOKUP + 1)
        .map(|number| format!("https://github.com/macro-inc/macro/pull/{number}"))
        .collect();
    assert!(matches!(
        service.sessions_for_pull_requests(&user(), &too_many).await,
        Err(AgentSessionError::TooManyPullRequests(_))
    ));
    assert!(matches!(
        service
            .sessions_for_pull_requests(
                &user(),
                &["https://github.com/macro-inc/macro/issues/1".to_owned()]
            )
            .await,
        Err(AgentSessionError::InvalidPullRequestUrl)
    ));
}
