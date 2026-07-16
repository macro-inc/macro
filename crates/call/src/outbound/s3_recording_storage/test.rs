use super::*;

const PRIVATE_KEY: &str = include_str!("test_private_key.pem");
const KEY_PAIR_ID: &str = "TEST-CLOUDFRONT-KEY";
const EXPIRES_AT: u64 = 2_000_000_000;

fn cloudfront_config(distribution_url: &str) -> RecordingCloudFrontConfig {
    RecordingCloudFrontConfig {
        distribution_url: distribution_url.to_string(),
        signer_public_key_id: KEY_PAIR_ID.to_string(),
        signer_private_key: PRIVATE_KEY.to_string(),
        presigned_url_expiry_seconds: 3600,
    }
}

fn assert_signature_parameters(url: &str) {
    let query = url.split_once('?').expect("signed URL must have a query").1;
    let parameters = query.split('&').collect::<Vec<_>>();

    assert!(parameters.contains(&format!("Expires={EXPIRES_AT}").as_str()));
    assert!(
        parameters
            .iter()
            .any(|parameter| parameter.starts_with("Signature=") && parameter.len() > 10)
    );
    assert!(parameters.contains(&format!("Key-Pair-Id={KEY_PAIR_ID}").as_str()));
}

#[test]
fn recording_url_uses_distribution_and_adds_calls_prefix() {
    let object_key = recording_object_key("room-id/recording.mp4");
    let url = cloudfront_signed_url(
        &cloudfront_config("https://location.example.test"),
        &object_key,
        EXPIRES_AT,
    )
    .unwrap();

    assert!(url.starts_with("https://location.example.test/calls/room-id/recording.mp4?"));
    assert_signature_parameters(&url);
}

#[test]
fn preview_url_normalizes_trailing_slash_without_adding_a_second_prefix() {
    let object_key = preview_object_key("calls/room-id/recording/PREVIEW.jpg");
    let url = cloudfront_signed_url(
        &cloudfront_config("https://location.example.test/"),
        object_key,
        EXPIRES_AT,
    )
    .unwrap();

    assert!(url.starts_with("https://location.example.test/calls/room-id/recording/PREVIEW.jpg?"));
    assert!(!url.contains("//calls"));
    assert!(!url.contains("calls/calls"));
    assert_signature_parameters(&url);
}

#[test]
fn path_sensitive_key_characters_are_encoded_without_changing_key_separators() {
    let object_key = recording_object_key("room name/a?#%/../café.mp4");
    let url = cloudfront_signed_url(
        &cloudfront_config("https://location.example.test///"),
        &object_key,
        EXPIRES_AT,
    )
    .unwrap();

    assert!(url.starts_with(
        "https://location.example.test/calls/room%20name/a%3F%23%25/%2E%2E/caf%C3%A9.mp4?"
    ));
    assert_signature_parameters(&url);
}

#[test]
fn malformed_distribution_url_is_rejected() {
    let error = cloudfront_signed_url(
        &cloudfront_config("location.example.test?origin=unexpected"),
        "calls/room/recording.mp4",
        EXPIRES_AT,
    )
    .unwrap_err();

    assert_eq!(error.to_string(), "invalid CloudFront distribution URL");
}

#[test]
fn recording_object_key_adds_calls_prefix() {
    assert_eq!(
        recording_object_key("room/recording.mp4"),
        "calls/room/recording.mp4"
    );
}

#[test]
fn preview_object_key_uses_stored_key_path_without_prefix_changes() {
    assert_eq!(
        preview_object_key("calls/room/recording/PREVIEW.jpg"),
        "calls/room/recording/PREVIEW.jpg"
    );
}
