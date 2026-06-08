use super::*;

#[test]
fn decode_s3_object_key_decodes_percent_encoding_and_spaces() -> anyhow::Result<()> {
    let decoded = decode_s3_object_key("calls/room+name/file%20name%2Bplus.mp4")?;

    assert_eq!(decoded, "calls/room name/file name+plus.mp4");
    Ok(())
}

#[test]
fn preview_keys_from_decoded_s3_key_derives_preview_key() {
    let decision = preview_keys_from_decoded_s3_key("calls/example-room/1700000000.mp4");

    assert_eq!(
        decision,
        KeyDecision::Process(PreviewKeys {
            source_key: "calls/example-room/1700000000.mp4".to_string(),
            recording_key: "example-room/1700000000.mp4".to_string(),
            preview_key: "calls/example-room/1700000000.mp4/PREVIEW.jpg".to_string(),
        })
    );
}

#[test]
fn preview_keys_from_decoded_s3_key_preserves_nested_parent_path() {
    let decision = preview_keys_from_decoded_s3_key("calls/org/example-room/recording.mp4");

    assert_eq!(
        decision,
        KeyDecision::Process(PreviewKeys {
            source_key: "calls/org/example-room/recording.mp4".to_string(),
            recording_key: "org/example-room/recording.mp4".to_string(),
            preview_key: "calls/org/example-room/recording.mp4/PREVIEW.jpg".to_string(),
        })
    );
}

#[test]
fn preview_keys_from_decoded_s3_key_skips_non_mp4_keys() {
    let decision = preview_keys_from_decoded_s3_key("calls/example-room/recording.mov");

    assert_eq!(decision, KeyDecision::Skip(SkipReason::NonMp4));
}

#[test]
fn preview_keys_from_decoded_s3_key_skips_preview_images() {
    let decision =
        preview_keys_from_decoded_s3_key("calls/example-room/1700000000.mp4/PREVIEW.jpg");

    assert_eq!(decision, KeyDecision::Skip(SkipReason::PreviewImage));
}

#[test]
fn preview_keys_from_decoded_s3_key_skips_keys_outside_calls_prefix() {
    let decision = preview_keys_from_decoded_s3_key("other/example-room/recording.mp4");

    assert_eq!(decision, KeyDecision::Skip(SkipReason::MissingCallsPrefix));
}
