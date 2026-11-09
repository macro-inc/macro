use core::time::Duration;
use criterion::measurement::{Measurement, ValueFormatter, WallTime};

const MAX_TIMING_LOAD: f64 = 150.0;

pub(super) fn check_load(text: &str) -> Result<(), String> {
    let load = text
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok());
    match load {
        Some(value) if value.is_finite() && (0.0..=MAX_TIMING_LOAD).contains(&value) => Ok(()),
        _ => Err(format!(
            "timing blocked: invalid or excessive one-minute load {load:?}; limit {MAX_TIMING_LOAD}"
        )),
    }
}
fn assert_current_load() {
    let load = std::fs::read_to_string("/proc/loadavg").expect("Linux timing load evidence");
    check_load(&load).expect("host load must permit timing");
}
pub(super) struct LoadGuardedTime;
impl Measurement for LoadGuardedTime {
    type Intermediate = <WallTime as Measurement>::Intermediate;
    type Value = Duration;
    fn start(&self) -> Self::Intermediate {
        assert_current_load();
        WallTime.start()
    }
    fn end(&self, start: Self::Intermediate) -> Self::Value {
        let elapsed = WallTime.end(start);
        assert_current_load();
        elapsed
    }
    fn add(&self, a: &Self::Value, b: &Self::Value) -> Self::Value {
        WallTime.add(a, b)
    }
    fn zero(&self) -> Self::Value {
        WallTime.zero()
    }
    fn to_f64(&self, value: &Self::Value) -> f64 {
        WallTime.to_f64(value)
    }
    fn formatter(&self) -> &dyn ValueFormatter {
        WallTime.formatter()
    }
}
