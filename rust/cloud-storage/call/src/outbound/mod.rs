/// AI-backed summarizer implementing [`CallSummarizer`](crate::domain::ports::CallSummarizer).
pub mod ai_call_summarizer;
/// LiveKit RTC client adapter implementing [`CallRtcClient`](crate::domain::ports::CallRtcClient).
pub mod livekit_rtc_client;
/// Postgres-backed repository implementing [`CallRepository`](crate::domain::ports::CallRepository).
pub mod pg_call_repo;
/// S3-backed recording storage implementing [`RecordingStorage`](crate::domain::ports::RecordingStorage).
pub mod s3_recording_storage;
