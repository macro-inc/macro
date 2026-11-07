use super::*;
use bytes::Bytes;

#[tokio::test]
async fn inspects_real_browser_containers_without_decoding_or_transcoding() {
    for bytes in [
        include_bytes!("../../../tests/fixtures/tone.webm").as_slice(),
        include_bytes!("../../../tests/fixtures/tone.ogg").as_slice(),
        include_bytes!("../../../tests/fixtures/tone.mp4").as_slice(),
        include_bytes!("../../../tests/fixtures/tone.wav").as_slice(),
    ] {
        let recording = Recording::new(Bytes::from_static(bytes), None).unwrap();
        let format = recording.format();
        let duration = SymphoniaRecordingInspector
            .duration(recording)
            .await
            .unwrap();
        // Codec framing/padding differs; each fixture contains 100 ms of audio.
        assert!(
            (0.09..0.25).contains(&duration.as_secs_f64()),
            "{format:?}: {duration:?}"
        );
    }
}

#[tokio::test]
async fn inspects_a_chrome_media_recorder_stream_without_container_duration() {
    let recording = Recording::new(
        Bytes::from_static(include_bytes!("../../../tests/fixtures/chrome.webm")),
        None,
    )
    .unwrap();
    let duration = SymphoniaRecordingInspector
        .duration(recording)
        .await
        .unwrap();
    assert_eq!(duration, Duration::from_millis(240));
}

#[tokio::test]
async fn rejects_header_only_audio() {
    let recording = Recording::new(
        Bytes::from_static(b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00"),
        None,
    )
    .unwrap();
    assert_eq!(
        SymphoniaRecordingInspector.duration(recording).await,
        Err(DictationError::InvalidAudio)
    );
}

#[tokio::test]
async fn identifies_long_compressed_audio_even_below_the_byte_limit() {
    let recording = Recording::new(
        Bytes::from_static(include_bytes!("../../../tests/fixtures/long.ogg")),
        None,
    )
    .unwrap();
    let duration = SymphoniaRecordingInspector
        .duration(recording)
        .await
        .unwrap();
    assert!(duration > crate::domain::MAX_AUDIO_DURATION);
}
