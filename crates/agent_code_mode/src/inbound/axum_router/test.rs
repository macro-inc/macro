use super::*;

#[test]
fn an_unreachable_connected_app_is_a_bad_gateway_not_an_internal_error() {
    let response = CodeExecutionApiError(CodeModeError::ConnectedAppUnreachable).into_response();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}

#[test]
fn an_agent_attributed_review_decision_is_forbidden() {
    let response = decode_user_decision(true, &HeaderMap::new(), b"invalid JSON")
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

    let response = decode_user_decision(false, &headers, b"invalid JSON")
        .err()
        .unwrap()
        .into_response();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn a_person_can_decide_a_review() {
    let decision = decode_user_decision(
        false,
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
        let response = decode_user_decision(true, &HeaderMap::new(), body)
            .err()
            .unwrap()
            .into_response();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}
