use super::*;

#[tokio::test]
async fn a_rate_limited_request_returns_429_with_retry_after() {
    let response = ApiError(ExternalChatError::RateLimited).into_response();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[header::RETRY_AFTER], "1");
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["code"], "rate_limited");
}

#[test]
fn verified_owner_api_credentials_remain_distinct_from_sessions_and_bots() {
    let agent = || Some(serde_json::from_value(serde_json::json!(Uuid::now_v7())).unwrap());
    for (origin, agent_id, expected) in [
        (CredentialOrigin::Session, None, SendAuthority::Human),
        (
            CredentialOrigin::Session,
            agent(),
            SendAuthority::Automation,
        ),
        (
            CredentialOrigin::MacroApiJwt,
            None,
            SendAuthority::UserApiToken,
        ),
        (
            CredentialOrigin::MacroApiJwt,
            agent(),
            SendAuthority::UserApiToken,
        ),
        (
            CredentialOrigin::UserApiKey,
            None,
            SendAuthority::UserApiToken,
        ),
        (CredentialOrigin::Bot, None, SendAuthority::Automation),
        (CredentialOrigin::Harness, None, SendAuthority::Automation),
        (CredentialOrigin::Internal, None, SendAuthority::Automation),
    ] {
        let user = MacroUserAuthentication {
            origin: origin.clone(),
            agent_id,
            agent_via: None,
            routine_id: None,
            macro_user_id: "macro|person@example.com".to_string().try_into().unwrap(),
            user_context: Default::default(),
        };
        assert_eq!(authority(&user), expected, "{origin:?}");
    }
}

/// The email rule, for external chats: an agent's program sends only with the
/// user's approval quoted; owner routines and the person's own credentials
/// send as before.
#[test]
fn an_agents_program_sends_only_with_the_users_quoted_approval() {
    use axum::http::HeaderMap;
    use macro_authorization::{CODE_EXECUTION_HEADER, CredentialAttribution};

    let refused = |result: Result<(), ApiError>| {
        result.err().is_some_and(|ApiError(error)| {
            error == ExternalChatError::ConfirmationRequired { dialect: false }
        })
    };
    let plain = HeaderMap::new();
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());

    assert!(
        refused(refuse_unconfirmed_program_send(
            CredentialAttribution::Agent,
            &plain,
            None
        )),
        "an agent token without a quote"
    );
    assert!(
        refused(refuse_unconfirmed_program_send(
            CredentialAttribution::Person,
            &program,
            None
        )),
        "a code-mode request without a quote"
    );
    assert!(
        refused(refuse_unconfirmed_program_send(
            CredentialAttribution::Agent,
            &plain,
            Some("  ")
        )),
        "a blank quote"
    );
    assert!(
        refuse_unconfirmed_program_send(
            CredentialAttribution::Agent,
            &program,
            Some("yes, send it")
        )
        .is_ok(),
        "an agent quoting the user's approval"
    );
    assert!(
        refuse_unconfirmed_program_send(CredentialAttribution::Person, &plain, None).is_ok(),
        "the person's own credential"
    );
    assert!(
        refuse_unconfirmed_program_send(CredentialAttribution::Routine, &plain, None).is_ok(),
        "an owner routine"
    );
}

#[test]
fn a_refused_program_send_says_how_to_proceed() {
    let refused = ExternalChatError::ConfirmationRequired { dialect: false };
    let response = ApiError(refused.clone()).into_response();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "confirmation_required");
    assert_eq!(refused.to_string(), PROGRAM_SEND_REFUSAL);
}

/// A dialect program's refusal names the dialect's operation.
#[test]
fn a_dialect_programs_refusal_names_its_operation() {
    use axum::http::HeaderMap;
    use macro_authorization::{CODE_EXECUTION_HEADER, CredentialAttribution, DIALECT_PROGRAM};

    let mut dialect = HeaderMap::new();
    dialect.insert(CODE_EXECUTION_HEADER, DIALECT_PROGRAM.parse().unwrap());
    let Err(ApiError(refused)) =
        refuse_unconfirmed_program_send(CredentialAttribution::Agent, &dialect, None)
    else {
        panic!("a dialect program without a quote is refused");
    };
    assert_eq!(
        refused,
        ExternalChatError::ConfirmationRequired { dialect: true }
    );
    assert_eq!(refused.to_string(), DIALECT_PROGRAM_SEND_REFUSAL);
}
