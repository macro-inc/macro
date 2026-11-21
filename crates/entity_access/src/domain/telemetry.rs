//! Trace helpers for access checks and the reads that call them.

/// A count as a span value. tracing-opentelemetry exports unsigned integers
/// as strings, so counts are recorded as `i64`.
pub fn span_count(count: usize) -> i64 {
    i64::try_from(count).unwrap_or(i64::MAX)
}
