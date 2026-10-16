use super::*;
use aws_sdk_sns::types::error::{
    EndpointDisabledException, InvalidParameterException, NotFoundException,
    PlatformApplicationDisabledException,
};

fn invalid_parameter(message: &str) -> PublishError {
    PublishError::InvalidParameterException(
        InvalidParameterException::builder()
            .message(message)
            .build(),
    )
}

#[test]
fn disabled_endpoint_is_unavailable() {
    let err = PublishError::EndpointDisabledException(
        EndpointDisabledException::builder()
            .message("Endpoint is disabled")
            .build(),
    );
    assert!(is_unavailable_endpoint(&err));
}

#[test]
fn deleted_endpoint_is_unavailable() {
    assert!(is_unavailable_endpoint(&invalid_parameter(
        "Invalid parameter: TargetArn Reason: No endpoint found for the target arn specified",
    )));
    assert!(is_unavailable_endpoint(&PublishError::NotFoundException(
        NotFoundException::builder()
            .message("Endpoint does not exist")
            .build(),
    )));
}

#[test]
fn message_and_platform_errors_are_not_unavailable() {
    assert!(!is_unavailable_endpoint(&invalid_parameter(
        "Invalid parameter: Message Reason: Invalid notification for protocol APNS: Notification is too long",
    )));
    assert!(!is_unavailable_endpoint(
        &PublishError::PlatformApplicationDisabledException(
            PlatformApplicationDisabledException::builder()
                .message("Platform application is disabled")
                .build(),
        )
    ));
}
