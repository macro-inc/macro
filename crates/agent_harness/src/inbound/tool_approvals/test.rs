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
