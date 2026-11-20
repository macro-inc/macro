use super::*;

#[test]
fn an_unreachable_connected_app_is_a_bad_gateway_not_an_internal_error() {
    let response = CodeExecutionApiError(CodeModeError::ConnectedAppUnreachable).into_response();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}

#[test]
fn an_agent_attributed_review_decision_is_forbidden() {
    let response = decode_user_decision(
        CredentialAttribution::Agent,
        &HeaderMap::new(),
        b"invalid JSON",
    )
    .err()
    .unwrap()
    .into_response();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn a_code_execution_review_decision_is_forbidden_without_agent_attribution() {
    let headers = HeaderMap::from_iter([(
        axum::http::HeaderName::from_static(macro_authorization::CODE_EXECUTION_HEADER),
        axum::http::HeaderValue::from_static("execution"),
    )]);

    let response = decode_user_decision(CredentialAttribution::Person, &headers, b"invalid JSON")
        .err()
        .unwrap()
        .into_response();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn a_person_can_decide_a_review() {
    let decision = decode_user_decision(
        CredentialAttribution::Person,
        &HeaderMap::new(),
        br#"{"action":"submit","revision":1,"items":[]}"#,
    );

    assert!(matches!(
        decision,
        Ok(ReviewDecision::Submit { revision: 1, .. })
    ));
}

#[test]
fn agent_runs_cannot_edit_submit_or_dismiss_a_review() {
    for body in [
        br#"{"action":"edit"}"#.as_slice(),
        br#"{"action":"submit","revision":1,"items":[]}"#.as_slice(),
        br#"{"action":"dismiss","revision":1,"items":[]}"#.as_slice(),
    ] {
        let response = decode_user_decision(CredentialAttribution::Agent, &HeaderMap::new(), body)
            .err()
            .unwrap()
            .into_response();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}

/// A routine code step running as its owner signs `routine_id` and no
/// `agent_id`; the token alone must refuse its decision.
#[test]
fn a_routine_owner_token_cannot_decide_a_review_without_the_marker() {
    let routine_step = macro_authorization::MacroUserAuthentication {
        origin: macro_authorization::CredentialOrigin::MacroApiJwt,
        agent_id: None,
        agent_via: None,
        routine_id: Some(Uuid::from_u128(0x7001)),
        macro_user_id: macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com")
            .unwrap(),
        user_context: Default::default(),
    };

    let response = decode_user_decision(
        routine_step.attribution(),
        &HeaderMap::new(),
        br#"{"action":"submit","revision":1,"items":[]}"#,
    )
    .err()
    .unwrap()
    .into_response();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn a_rate_limited_connected_app_is_too_many_requests_with_retry_after() {
    let response = CodeExecutionApiError(CodeModeError::ConnectedAppRateLimited {
        retry_after: Some(std::time::Duration::from_millis(1500)),
    })
    .into_response();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response.headers()[axum::http::header::RETRY_AFTER],
        "2",
        "Retry-After rounds up to whole seconds"
    );
}
