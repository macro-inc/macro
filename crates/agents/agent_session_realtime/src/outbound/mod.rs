//! Transport adapters feeding the fan-out.

/// Runs of frames over a Redis Stream: the harness' publisher and the
/// consumer-group reader.
pub mod redis_stream;
