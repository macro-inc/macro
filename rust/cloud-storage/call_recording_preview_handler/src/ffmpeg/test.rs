use std::path::Path;

use super::*;

#[test]
fn parse_duration_reads_first_non_empty_line() -> anyhow::Result<()> {
    let duration = parse_duration("\n12.345678\n")?;

    assert_eq!(duration, 12.345678);
    Ok(())
}

#[test]
fn parse_duration_rejects_missing_duration() {
    let error = parse_duration("\n\t\n").expect_err("empty output should fail");

    assert!(
        error
            .to_string()
            .contains("ffprobe did not return a duration")
    );
}

#[test]
fn parse_duration_rejects_non_numeric_duration() {
    let error = parse_duration("N/A\n").expect_err("non-numeric output should fail");

    assert!(
        error
            .to_string()
            .contains("failed to parse ffprobe duration")
    );
}

#[tokio::test]
async fn probe_duration_reports_missing_ffprobe_executable() {
    let missing_ffprobe = Path::new("/tmp/macro-call-preview-missing-ffprobe");
    let error = probe_duration(missing_ffprobe, "https://example.invalid/recording.mp4")
        .await
        .expect_err("missing ffprobe executable should fail");

    assert!(error.to_string().contains("failed to run ffprobe"));
}

#[test]
fn format_seek_seconds_uses_millisecond_precision() {
    assert_eq!(format_seek_seconds(1.23456), "1.235");
}
