//! What a user's new coding sessions are told to do beyond their assignment.

/// A user's choices for how new coding sessions deliver their work.
///
/// Every choice defaults to off.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CodingPreferences {
    /// Research prior work and link each session to a Macro task.
    pub create_tasks: bool,
    /// Deliver the work as a pull request registered with the session.
    pub open_pull_requests: bool,
}
