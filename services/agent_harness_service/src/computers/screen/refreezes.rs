//! Refreezes of drives a renewal found unfrozen: each computer's run in
//! their own task, one at a time; a request that comes while one runs is
//! kept (the latest wins) and run right after it, so a drive that is still
//! live is never left unfrozen because its request came at the wrong time.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use computer_screen::domain::models::DriveId;
use hosted_runtimes::domain::ids::ComputerId;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

/// Runs one refreeze.
pub type Refreeze =
    Arc<dyn Fn(ComputerId, DriveId) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// Each computer with a refreeze running, and the request that came while
/// it ran.
type InFlight = Arc<Mutex<HashMap<ComputerId, Option<DriveId>>>>;

/// Refreezes, one at a time per computer, on `tasks`.
pub struct Refreezes {
    in_flight: InFlight,
    tasks: TaskTracker,
    run: Refreeze,
}

impl Refreezes {
    /// Run each refreeze with `run`, on `tasks`.
    pub fn new(run: Refreeze, tasks: TaskTracker) -> Self {
        Self {
            in_flight: Arc::default(),
            tasks,
            run,
        }
    }

    /// Refreeze `drive` on `computer`: now, or after the one running there.
    pub fn request(&self, computer: ComputerId, drive: DriveId) {
        {
            let mut in_flight = lock(&self.in_flight);
            if let Some(waiting) = in_flight.get_mut(&computer) {
                *waiting = Some(drive);
                return;
            }
            in_flight.insert(computer, None);
        }
        let guard = Running {
            in_flight: Arc::clone(&self.in_flight),
            computer,
            finished: false,
        };
        let run = Arc::clone(&self.run);
        let requests = Arc::clone(&self.in_flight);
        self.tasks.spawn(async move {
            // The whole guard moves in, not just the field written below.
            let mut guard = guard;
            let mut drive = drive;
            loop {
                run(computer, drive).await;
                // Taking the next request and freeing the computer happen
                // under one lock, so a request is never lost between them.
                let mut in_flight = lock(&requests);
                match in_flight.get_mut(&computer).and_then(Option::take) {
                    Some(waiting) => drive = waiting,
                    None => {
                        in_flight.remove(&computer);
                        guard.finished = true;
                        return;
                    }
                }
            }
        });
    }
}

fn lock(in_flight: &InFlight) -> std::sync::MutexGuard<'_, HashMap<ComputerId, Option<DriveId>>> {
    in_flight
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A computer's refreeze task: if it ends without freeing the computer (a
/// panic), dropping it does, so the computer is never left marked busy.
struct Running {
    in_flight: InFlight,
    computer: ComputerId,
    finished: bool,
}

impl Drop for Running {
    fn drop(&mut self) {
        if !self.finished {
            lock(&self.in_flight).remove(&self.computer);
        }
    }
}
