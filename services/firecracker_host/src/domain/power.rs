//! Which steps take a VM from its power state to what an action asks for.
//! Pure, so every pair of state and action is tested without a VMM.

use firecracker_host_api::{Action, PowerState};

#[cfg(test)]
mod test;

/// One thing the agent does to a VM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Start a process: restore the golden when the rootfs was never booted,
    /// otherwise cold boot the computer's own rootfs.
    Boot,
    /// Start a process restoring the computer's hibernation snapshot.
    Wake,
    /// Resume paused vCPUs.
    Resume,
    /// Pause the vCPUs.
    Pause,
    /// Clean guest shutdown, killed after the grace period; ends the process.
    Shutdown,
    /// Snapshot memory and devices to disk, then end the process.
    Hibernate,
    /// Delete the hibernation snapshot (its memory state is dropped).
    DiscardHibernation,
}

/// The action does not apply to the state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("cannot {action:?} a computer that is {state}")]
pub struct NotApplicable {
    /// Where the VM stands.
    pub state: PowerState,
    /// What was asked.
    pub action: Action,
}

/// The steps for `action` from `state`, in order; empty when the VM is
/// already where the action leads.
pub fn plan(state: PowerState, action: Action) -> Result<&'static [Step], NotApplicable> {
    use Action as A;
    use PowerState as S;
    use Step::*;

    let steps: &'static [Step] = match (action, state) {
        (A::Start, S::Running) => &[],
        (A::Start, S::Paused) => &[Resume],
        (A::Start, S::Hibernated) => &[Wake],
        (A::Start, S::Stopped) => &[Boot],

        (A::Stop, S::Running) => &[Shutdown],
        // Resumed first so the guest shuts down cleanly.
        (A::Stop, S::Paused) => &[Resume, Shutdown],
        (A::Stop, S::Hibernated) => &[DiscardHibernation],
        (A::Stop, S::Stopped) => &[],

        (A::Restart, S::Running) => &[Shutdown, Boot],
        (A::Restart, S::Paused) => &[Resume, Shutdown, Boot],
        (A::Restart, S::Hibernated) => &[Wake, Shutdown, Boot],
        (A::Restart, S::Stopped) => &[Boot],

        (A::Freeze, S::Running) => &[Pause],
        (A::Freeze, S::Paused) => &[],

        (A::Unfreeze, S::Paused) => &[Resume],
        (A::Unfreeze, S::Running) => &[],

        (A::Hibernate, S::Running) => &[Pause, Hibernate],
        (A::Hibernate, S::Paused) => &[Hibernate],
        (A::Hibernate, S::Hibernated) => &[],

        (A::Freeze | A::Unfreeze, S::Hibernated | S::Stopped) | (A::Hibernate, S::Stopped) => {
            return Err(NotApplicable { state, action });
        }
    };
    Ok(steps)
}

/// The state after `step` succeeds.
pub fn after(step: Step) -> PowerState {
    match step {
        Step::Boot | Step::Wake | Step::Resume => PowerState::Running,
        Step::Pause => PowerState::Paused,
        Step::Shutdown | Step::DiscardHibernation => PowerState::Stopped,
        Step::Hibernate => PowerState::Hibernated,
    }
}
