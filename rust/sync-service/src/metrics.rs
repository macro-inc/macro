#[macro_export]
macro_rules! timeit {
    ($code:expr) => {{
        let start = web_time::Instant::now();
        let out = { $code };
        (out, start.elapsed())
    }};
}

#[macro_export]
macro_rules! timeit_log {
    ($code:expr) => {{ $crate::timeit_log!($code, ::tracing::debug) }};
    ($code:expr, $logger:path) => {{
        let (result, duration) = $crate::timeit!($code);
        $logger!(duration_ms = duration.as_millis());
        result
    }};
    ($fmt:literal, $code:expr) => {{
        let (result, duration) = $crate::timeit!($code);
        ::tracing::debug!(duration_ms = duration.as_millis(), $fmt);
        result
    }};
    ($fmt:literal, $code:expr, $logger:expr) => {{
        let (result, duration) = $crate::timeit!($code);
        $logger!(duration_ms = duration.as_millis(), $literal);
    }};
}

#[macro_export]
macro_rules! timeit_log_if_slow {
    ($fmt:literal, $code:expr) => {{ $crate::timeit_log_if_slow(1, $fmt, $code) }};
    ($max_time:literal, $fmt:literal, $code:expr) => {{
        let (out, elapsed) = $crate::timeit!($code);
        let ms = elapsed.as_millis();
        if ms > $max_time {
            tracing::debug!(duration_ms = ms, $fmt);
        }
        out
    }};
}
