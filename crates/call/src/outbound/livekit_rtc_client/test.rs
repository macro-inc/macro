use livekit_protocol::VideoCodec;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::models::EgressS3Config;
use crate::domain::ports::CallRtcClient as _;

fn s3_config() -> EgressS3Config {
    EgressS3Config {
        bucket: "recordings-bucket".to_string(),
        region: "us-east-1".to_string(),
        access_key: "test-access-key".to_string(),
        secret: "test-secret".to_string(),
    }
}

fn client() -> LivekitRtcClient {
    LivekitRtcClient::new(
        "wss://lk.example",
        "test-api-key",
        "test-api-secret-test-api-secret-test",
        None,
    )
}

#[tokio::test]
async fn verify_access_token_round_trips_identity_and_room() {
    let client = client();
    let identity = MacroUserIdStr::try_from_email("alice@example.com").unwrap();

    let token = client
        .generate_token("room-1", identity.clone())
        .await
        .expect("token mint is pure JWT crypto, no network");

    let verified = client.verify_access_token(&token).expect("token verifies");
    assert_eq!(verified.identity, identity.as_ref());
    assert_eq!(verified.room.as_deref(), Some("room-1"));
}

#[tokio::test]
async fn verify_access_token_rejects_token_signed_with_a_different_secret() {
    let identity = MacroUserIdStr::try_from_email("alice@example.com").unwrap();
    let token = client()
        .generate_token("room-1", identity)
        .await
        .expect("token mint is pure JWT crypto, no network");

    let other = LivekitRtcClient::new(
        "wss://lk.example",
        "test-api-key",
        "a-completely-different-secret-value!",
        None,
    );
    assert!(other.verify_access_token(&token).is_err());
}

#[test]
fn verify_access_token_rejects_garbage() {
    assert!(client().verify_access_token("not-a-jwt").is_err());
}

#[test]
fn room_composite_request_asks_the_stock_template_to_stage_a_shared_screen() {
    let request = build_room_composite_egress_request("room-1", &s3_config());
    assert_eq!(request.options.layout, "grid");
    assert!(request.options.custom_base_url.is_empty());
}

#[test]
fn room_composite_request_writes_one_mp4_under_the_room_prefix() {
    let request = build_room_composite_egress_request("room-1", &s3_config());
    assert_eq!(request.outputs.len(), 1);
    let EgressOutput::File(file) = &request.outputs[0] else {
        panic!("expected one file output");
    };
    assert_eq!(file.filepath, "calls/room-1/{time}");
    assert_eq!(file.file_type, EncodedFileType::Mp4 as i32);
}

#[test]
fn room_composite_request_uploads_to_the_configured_bucket() {
    let request = build_room_composite_egress_request("room-1", &s3_config());
    let EgressOutput::File(file) = &request.outputs[0] else {
        panic!("expected one file output");
    };
    let Some(encoded_file_output::Output::S3(s3)) = &file.output else {
        panic!("expected S3 upload");
    };
    assert_eq!(s3.bucket, "recordings-bucket");
    assert_eq!(s3.region, "us-east-1");
}

#[test]
fn room_composite_request_encodes_for_browser_playback() {
    let request = build_room_composite_egress_request("room-1", &s3_config());
    let encoding = &request.options.encoding;
    assert_eq!(encoding.width, 1920);
    assert_eq!(encoding.height, 1080);
    assert_eq!(encoding.framerate, 30);
    assert_eq!(encoding.video_bitrate, 4500);
    assert_eq!(encoding.video_codec, VideoCodec::H264Main);
    assert_eq!(encoding.audio_codec, AudioCodec::Aac);
}
