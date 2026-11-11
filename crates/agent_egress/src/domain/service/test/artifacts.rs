use super::*;
use crate::domain::model::ArtifactEndpoint;
use crate::domain::ports::ArtifactCalls;

/// Records whom each artifact call was resolved for, and addresses it at a
/// fixed storage base.
#[derive(Default)]
struct RecordingArtifactCalls {
    resolved: Mutex<Vec<(String, BotId, ArtifactEndpoint)>>,
}

#[async_trait::async_trait]
impl ArtifactCalls for RecordingArtifactCalls {
    async fn resolve(
        &self,
        user: &MacroUserIdStr<'static>,
        agent: BotId,
        _session: uuid::Uuid,
        endpoint: ArtifactEndpoint,
    ) -> Result<UpstreamCall, EgressError> {
        self.resolved
            .lock()
            .expect("lock")
            .push((user.to_string(), agent, endpoint));
        UpstreamCall::bearer(
            Url::parse(&format!("https://storage.example.com{}", endpoint.path())).expect("url"),
            BearerToken::new("user-token"),
        )
    }
}

fn artifact_id() -> macro_uuid::Uuid {
    macro_uuid::Uuid::parse_str("0198a7b2-6c1d-7f00-8000-000000000001").expect("uuid")
}

/// A teammate's turn publishes to the teammate's own account: it is resolved
/// for them, stamped with their token in place of the session token, and
/// needs nobody's approval.
#[tokio::test]
async fn an_artifact_call_acts_as_the_person_who_prompted_the_turn() {
    let teammate = MacroUserIdStr::try_from_email("teammate@macro.com").expect("user");
    let calls = Arc::new(RecordingArtifactCalls::default());
    let service = gated(
        prompted_by(Some(teammate.clone())),
        SpyCredentials::knowing(),
    )
    .with_artifacts(calls.clone());

    let response = service
        .proxy(
            &SessionToken::new("session-token"),
            EgressTarget::Artifacts(ArtifactEndpoint::Uploads(artifact_id())),
            request(
                Method::POST,
                &[
                    ("authorization", "Bearer session-token"),
                    ("content-type", "application/json"),
                ],
            ),
        )
        .await
        .expect("forwarded");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        *calls.resolved.lock().expect("lock"),
        vec![(
            teammate.to_string(),
            BotId::TEST_A,
            ArtifactEndpoint::Uploads(artifact_id())
        )]
    );
    service.forward.forwarded(|parts| {
        assert_eq!(
            parts.uri.to_string(),
            "https://storage.example.com/artifacts/0198a7b2-6c1d-7f00-8000-000000000001/uploads"
        );
        assert_eq!(parts.headers[AUTHORIZATION], "Bearer user-token");
        assert_eq!(parts.headers["content-type"], "application/json");
    });
    assert!(service.approvals.held.lock().expect("lock").is_empty());
}

/// A system turn acts for nobody, so it cannot publish as anybody.
#[tokio::test]
async fn an_artifact_call_in_a_turn_nobody_prompted_is_refused() {
    let StubSessions(Ok(mut grant)) = prompted_by(None) else {
        unreachable!("granting grants");
    };
    if let Some(prompter) = grant.prompter.as_mut() {
        prompter.kind = agent_session::domain::model::PrompterKind::System;
        prompter.user = Some(owner());
    }
    let calls = Arc::new(RecordingArtifactCalls::default());
    let service =
        gated(StubSessions(Ok(grant)), SpyCredentials::knowing()).with_artifacts(calls.clone());

    let refused = service
        .proxy(
            &SessionToken::new("session-token"),
            EgressTarget::Artifacts(ArtifactEndpoint::Create),
            request(Method::POST, &[]),
        )
        .await;

    assert!(matches!(refused, Err(EgressError::NoActingUser)));
    assert!(calls.resolved.lock().expect("lock").is_empty());
    assert!(!service.forward.was_called());
}

#[tokio::test]
async fn an_artifact_call_is_not_routed_when_artifacts_are_not_configured() {
    let service = gated(prompted_by(Some(owner())), SpyCredentials::knowing());

    let refused = service
        .proxy(
            &SessionToken::new("session-token"),
            EgressTarget::Artifacts(ArtifactEndpoint::Create),
            request(Method::POST, &[]),
        )
        .await;

    assert!(matches!(refused, Err(EgressError::Unroutable(_))));
    assert!(!service.forward.was_called());
}
