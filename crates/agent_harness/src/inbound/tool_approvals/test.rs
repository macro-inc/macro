use super::*;

#[test]
fn refusals_answer_with_the_status_the_buttons_branch_on() {
    let status = |error| ToolApprovalApiError(error).into_response().status();
    assert_eq!(status(ToolApprovalError::NotFound), StatusCode::NOT_FOUND);
    assert_eq!(status(ToolApprovalError::NotPending), StatusCode::CONFLICT);
    assert_eq!(status(ToolApprovalError::NotOwner), StatusCode::FORBIDDEN);
    assert_eq!(
        status(ToolApprovalError::NobodyToRemember),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[test]
fn the_wire_speaks_snake_case() {
    let request: AnswerToolApprovalRequest =
        serde_json::from_value(serde_json::json!({ "answer": "deny" })).unwrap();
    assert_eq!(ApprovalAnswer::from(request.answer), ApprovalAnswer::Deny);
    let request: AnswerToolApprovalRequest =
        serde_json::from_value(serde_json::json!({ "answer": "approve_and_remember" })).unwrap();
    assert_eq!(
        ApprovalAnswer::from(request.answer),
        ApprovalAnswer::ApproveAndRemember
    );
    let response = AnswerToolApprovalResponse {
        status: ToolApprovalStatus::Cancelled.into(),
    };
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        serde_json::json!({ "status": "cancelled" })
    );
}

#[test]
fn an_agent_cannot_approve_a_held_call() {
    let response = refuse_program_approval(ToolApprovalAnswerDto::Approve, true, &HeaderMap::new())
        .unwrap_err()
        .into_response();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn an_agent_can_deny_a_held_call() {
    let result = refuse_program_approval(ToolApprovalAnswerDto::Deny, true, &HeaderMap::new());

    assert!(result.is_ok());
}

#[test]
fn both_agent_run_markers_refuse_approvals_but_allow_denial_and_cancellation() {
    let execution_headers = HeaderMap::from_iter([(
        axum::http::HeaderName::from_static(macro_authorization::CODE_EXECUTION_HEADER),
        axum::http::HeaderValue::from_static("execution"),
    )]);

    for (attributed, headers) in [(true, HeaderMap::new()), (false, execution_headers)] {
        for answer in [
            ToolApprovalAnswerDto::Approve,
            ToolApprovalAnswerDto::ApproveAndRemember,
        ] {
            let response = refuse_program_approval(answer, attributed, &headers)
                .unwrap_err()
                .into_response();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
        for answer in [ToolApprovalAnswerDto::Deny, ToolApprovalAnswerDto::Cancel] {
            assert!(refuse_program_approval(answer, attributed, &headers).is_ok());
        }
    }
}

#[test]
fn a_person_can_approve_or_remember_a_held_call() {
    for answer in [
        ToolApprovalAnswerDto::Approve,
        ToolApprovalAnswerDto::ApproveAndRemember,
    ] {
        assert!(refuse_program_approval(answer, false, &HeaderMap::new()).is_ok());
    }
}
