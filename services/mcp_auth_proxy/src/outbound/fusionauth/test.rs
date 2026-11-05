use std::time::Duration;

use fusionauth::error::{FusionAuthClientError, GenericErrorResponse, OAuth2TokenError};
use upstream_error::UpstreamFailure;

use super::grant_error;
use crate::domain::ports::UpstreamGrantError;

fn refused(error: &str, reason: &str) -> FusionAuthClientError {
    FusionAuthClientError::OAuth2TokenRefused(OAuth2TokenError {
        error: error.to_owned(),
        error_reason: Some(reason.to_owned()),
        error_description: Some("The refresh_token is invalid.".to_owned()),
    })
}

#[test]
fn a_refresh_token_fusionauth_no_longer_holds_is_an_invalid_grant() {
    let error = grant_error(refused("invalid_grant", "refresh_token_not_found"));

    let UpstreamGrantError::InvalidGrant { detail } = error else {
        panic!("expected an invalid grant, got {error:?}");
    };
    assert_eq!(
        detail,
        "invalid_grant (refresh_token_not_found): The refresh_token is invalid."
    );
}

#[test]
fn a_rejected_client_credential_is_our_fault_and_keeps_its_detail() {
    let error = grant_error(refused("invalid_client", "invalid_client_authentication"));

    assert!(
        matches!(error, UpstreamGrantError::Failed(_)),
        "got {error:?}"
    );
    assert!(
        error
            .to_string()
            .contains("invalid_client (invalid_client_authentication)"),
        "the upstream reason must survive into logs: {error}"
    );
}

#[test]
fn an_outage_is_unavailable() {
    let error = grant_error(FusionAuthClientError::Upstream {
        service: fusionauth::error::SERVICE_NAME,
        failure: UpstreamFailure::Unavailable,
    });

    assert!(
        matches!(error, UpstreamGrantError::Unavailable { retry_after: None }),
        "got {error:?}"
    );
}

#[test]
fn throttling_is_unavailable_and_keeps_retry_after() {
    let error = grant_error(FusionAuthClientError::Upstream {
        service: fusionauth::error::SERVICE_NAME,
        failure: UpstreamFailure::RateLimited {
            retry_after: Some(Duration::from_secs(7)),
        },
    });

    assert!(
        matches!(
            error,
            UpstreamGrantError::Unavailable {
                retry_after: Some(retry_after)
            } if retry_after == Duration::from_secs(7)
        ),
        "got {error:?}"
    );
}

#[test]
fn an_unusable_answer_is_a_failure() {
    for error in [
        FusionAuthClientError::Upstream {
            service: fusionauth::error::SERVICE_NAME,
            failure: UpstreamFailure::InvalidResponse,
        },
        FusionAuthClientError::Generic(GenericErrorResponse {
            message: "<html>bad</html>".to_owned(),
        }),
    ] {
        let error = grant_error(error);
        assert!(
            matches!(error, UpstreamGrantError::Failed(_)),
            "got {error:?}"
        );
    }
}
