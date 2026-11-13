/// AI-backed summarizer implementing [`CallSummarizer`](crate::domain::ports::CallSummarizer).
#[cfg(feature = "outbound")]
pub mod ai_call_summarizer;
/// Flag-gated channel threads implementing [`ChannelThreads`](crate::domain::ports::ChannelThreads).
#[cfg(feature = "outbound")]
pub mod channel_threads;
/// LiveKit RTC client adapter implementing [`CallRtcClient`](crate::domain::ports::CallRtcClient).
#[cfg(feature = "outbound")]
pub mod livekit_rtc_client;
/// Read-only RTC attendance evidence for scheduled meetings.
#[cfg(any(feature = "outbound", feature = "attendance"))]
pub mod meeting_attendance;
/// Postgres-backed repository implementing [`CallRepository`](crate::domain::ports::CallRepository).
#[cfg(feature = "outbound")]
pub mod pg_call_repo;
/// Atomic import persistence and owner-scoped reads.
#[cfg(feature = "outbound")]
pub mod pg_imported_call_repo;
/// Postgres-backed repository implementing [`VoiceRepository`](crate::domain::ports::VoiceRepository).
#[cfg(feature = "outbound")]
pub mod pg_voice_repo;
/// Per-caller remote flag for explicit programmatic call routes.
#[cfg(feature = "outbound")]
pub mod programmatic_calls;
/// S3-backed recording storage implementing [`RecordingStorage`](crate::domain::ports::RecordingStorage).
#[cfg(feature = "outbound")]
pub mod s3_recording_storage;
