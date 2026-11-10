use super::refuse_program_caller;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;

#[test]
fn a_program_request_cannot_start_a_run() {
    let mut program = HeaderMap::new();
    program.insert(
        macro_authorization::CODE_EXECUTION_HEADER,
        "1".parse().unwrap(),
    );

    // A document program's token carries no agent; its header still refuses it.
    let refused = refuse_program_caller(false, &program).unwrap_err();
    assert_eq!(refused.into_response().status(), StatusCode::FORBIDDEN);

    let agent = refuse_program_caller(true, &HeaderMap::new()).unwrap_err();
    assert_eq!(agent.into_response().status(), StatusCode::FORBIDDEN);

    assert!(refuse_program_caller(false, &HeaderMap::new()).is_ok());
}
