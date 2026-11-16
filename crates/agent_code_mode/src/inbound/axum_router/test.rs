use super::*;

#[test]
fn an_unreachable_connected_app_is_a_bad_gateway_not_an_internal_error() {
    let response = CodeExecutionApiError(CodeModeError::ConnectedAppUnreachable).into_response();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}
