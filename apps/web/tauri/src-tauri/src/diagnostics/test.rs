use super::*;

fn sample() -> MemorySample {
    MemorySample {
        sequence: 0,
        timestamp_ms: 1,
        processes: vec![],
        frontend_status: FrontendStatus::Unavailable,
        error: None,
    }
}

#[test]
fn reads_resume_without_duplicates_and_report_evicted_samples() {
    let mut buffer = SampleBuffer::default();
    for _ in 0..MAX_SAMPLES + 2 {
        buffer.push(sample());
    }
    let (samples, dropped) = buffer.read(0);
    assert_eq!(samples.len(), MAX_SAMPLES);
    assert_eq!(dropped, 2);
    assert_eq!(samples.first().unwrap().sequence, 3);
    let (samples, dropped) = buffer.read(MAX_SAMPLES as u64 + 1);
    assert_eq!(samples.len(), 1);
    assert_eq!(dropped, 0);
    assert_eq!(samples[0].sequence, MAX_SAMPLES as u64 + 2);
    assert!(buffer.read(MAX_SAMPLES as u64 + 2).0.is_empty());
}

#[cfg(target_os = "macos")]
#[test]
fn only_known_webkit_executables_are_classified() {
    assert_eq!(
        macos::role_for_path("/System/Library/com.apple.WebKit.WebContent"),
        Some(ProcessRole::WebContent)
    );
    assert_eq!(
        macos::role_for_path("/System/Library/com.apple.WebKit.WebContent.CaptivePortal"),
        Some(ProcessRole::WebContent)
    );
    assert_eq!(
        macos::role_for_path("/System/Library/com.apple.WebKit.GPU"),
        Some(ProcessRole::Gpu)
    );
    assert_eq!(
        macos::role_for_path("/System/Library/com.apple.WebKit.Networking"),
        Some(ProcessRole::Network)
    );
    assert_eq!(
        macos::role_for_path("/tmp/not-com.apple.WebKit.WebContent"),
        None
    );
}

#[cfg(target_os = "macos")]
#[test]
fn sampler_reports_native_memory_or_an_explicit_error_without_fabricating_frontend_usage() {
    let sample = macos::sample(std::process::id());
    if let Some(native) = sample
        .processes
        .iter()
        .find(|p| p.role == ProcessRole::Native)
    {
        assert!(native.resident_bytes > 0);
        assert!(native.footprint_bytes > 0);
    } else {
        assert!(sample.error.is_some());
    }
    assert_eq!(sample.frontend_status, FrontendStatus::Unavailable);
    assert!(
        sample
            .processes
            .iter()
            .all(|p| p.role == ProcessRole::Native)
    );
}
