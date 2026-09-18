use super::PreviewError;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

/// Shared per-account byte and request ceilings, including upgraded streams.
pub struct Budget {
    state: Mutex<State>,
}
struct State {
    second: Instant,
    next_byte: Instant,
    requests: u32,
    total: u64,
}
impl Default for Budget {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                second: Instant::now(),
                next_byte: Instant::now(),
                requests: 0,
                total: 0,
            }),
        }
    }
}
impl Budget {
    /// Charge actual bytes and return the delay enforcing 5 MiB/s across all streams. The total-byte ceiling closes streams.
    pub fn bytes(&self, count: usize) -> Result<Duration, PreviewError> {
        self.charge(count as u64, 0)
    }
    /// Charge one authenticated HTTP request or upgrade handshake.
    pub fn request(&self) -> Result<(), PreviewError> {
        self.charge(0, 1).map(|_| ())
    }
    fn charge(&self, bytes: u64, requests: u32) -> Result<Duration, PreviewError> {
        let mut state = self.state.lock().expect("budget mutex");
        if state.second.elapsed() >= Duration::from_secs(1) {
            state.second = Instant::now();
            state.requests = 0;
        }
        state.total = state.total.saturating_add(bytes);
        state.requests = state.requests.saturating_add(requests);
        if state.total > 1024 * 1024 * 1024 || state.requests > 100 {
            return Err(PreviewError::Limited);
        }
        let now = Instant::now();
        state.next_byte = state.next_byte.max(now)
            + Duration::from_secs_f64(bytes as f64 / (5.0 * 1024.0 * 1024.0));
        Ok(state.next_byte.saturating_duration_since(now))
    }
}
