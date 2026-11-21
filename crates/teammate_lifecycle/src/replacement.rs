//! How the container backend replaces an install's image:
//!
//! 1. fetch and verify the new image id;
//! 2. stop the agent with a checkpoint ([`CHECKPOINT_GRACE`]);
//! 3. start the new image on the same volumes;
//! 4. if it isn't up for [`TRIAL`], or the fetch failed, start the previous
//!    image again with the new credentials: *rolledBack {reason}*.
//!
//! Hosted computers get new images through their VM image, never this.

use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};

use crate::exit::Exit;
use crate::supervisor::ExitEvent;

#[cfg(test)]
mod test;

/// How long a stopping agent has for its last sync before it is killed.
pub const CHECKPOINT_GRACE: Duration = Duration::from_secs(90);

/// How long a new image must stay up to replace the previous one.
pub const TRIAL: TimeDelta = TimeDelta::seconds(120);

/// How fetching the new image went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fetch {
    /// Fetched, with the id asked for.
    Verified,
    /// It couldn't be fetched.
    Unavailable,
    /// The fetched image's id differs.
    Mismatch,
}

/// Why an update didn't take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum UpdateFailure {
    /// The image couldn't be fetched.
    ImageUnavailable,
    /// The fetched image's id differs.
    ImageMismatch,
    /// It died within [`TRIAL`].
    CrashLoop,
}

/// What the status says while an image runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateStatus {
    /// The new image, on trial.
    Trying,
    /// The previous image, because the new one failed.
    RolledBack(UpdateFailure),
}

/// What the backend does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateAction<Image> {
    /// Stop the agent with a checkpoint, then start `image` on the same
    /// volumes with the new credentials.
    Run {
        /// The image to run.
        image: Image,
        /// What the status says.
        status: UpdateStatus,
    },
    /// No image to run.
    Fail(UpdateFailure),
    /// Nothing changes: the supervisor's policy decides.
    Continue,
}

/// Where an update is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
enum Stage {
    Fetching,
    Trial { started: Option<DateTime<Utc>> },
    Settled,
    RolledBack { reason: UpdateFailure },
}

/// One install's image update, persisted between macrod runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageUpdate<Image> {
    previous: Option<Image>,
    next: Image,
    stage: Stage,
}

impl<Image: Clone + PartialEq> ImageUpdate<Image> {
    /// An update from `previous` (none for a first image) to `next`.
    pub fn new(previous: Option<Image>, next: Image) -> Self {
        Self {
            previous,
            next,
            stage: Stage::Fetching,
        }
    }

    /// The image that runs, or will.
    pub fn running(&self) -> &Image {
        &self.next
    }

    /// Why the update went back to the previous image, if it did.
    pub fn rolled_back(&self) -> Option<UpdateFailure> {
        match self.stage {
            Stage::RolledBack { reason } => Some(reason),
            Stage::Fetching | Stage::Trial { .. } | Stage::Settled => None,
        }
    }

    /// When the new image's trial ends, while it runs one.
    pub fn trial_ends(&self) -> Option<DateTime<Utc>> {
        match self.stage {
            Stage::Trial {
                started: Some(started),
            } => Some(started + TRIAL),
            Stage::Fetching | Stage::Trial { started: None } | Stage::Settled => None,
            Stage::RolledBack { .. } => None,
        }
    }

    /// The fetch ended: try the new image, or run the previous one.
    pub fn fetched(&mut self, fetch: Fetch) -> UpdateAction<Image> {
        let reason = match fetch {
            Fetch::Verified => {
                // The same image again (new credentials only) has nothing
                // to try.
                self.stage = if self.previous.as_ref() == Some(&self.next) {
                    Stage::Settled
                } else {
                    Stage::Trial { started: None }
                };
                return UpdateAction::Run {
                    image: self.next.clone(),
                    status: UpdateStatus::Trying,
                };
            }
            Fetch::Unavailable => UpdateFailure::ImageUnavailable,
            Fetch::Mismatch => UpdateFailure::ImageMismatch,
        };
        self.roll_back(reason)
    }

    /// The image started. The trial runs from its first start: a restart
    /// after a land doesn't begin it again.
    pub fn started(&mut self, now: DateTime<Utc>) {
        if let Stage::Trial { started: None } = self.stage {
            self.stage = Stage::Trial { started: Some(now) };
        }
    }

    /// Whether the new image has now been up for [`TRIAL`]; from then on
    /// it is the previous image of the next update.
    pub fn settle(&mut self, now: DateTime<Utc>) -> bool {
        match self.stage {
            Stage::Trial {
                started: Some(started),
            } if now - started >= TRIAL => {
                self.stage = Stage::Settled;
                true
            }
            Stage::Settled => true,
            Stage::Fetching | Stage::Trial { .. } | Stage::RolledBack { .. } => false,
        }
    }

    /// The agent exited. A crash, a bad setting or a lost process within
    /// the trial rolls back to the previous image, once. Anything else is
    /// the supervisor's: a stop, a restart after a land, or a terminal code
    /// that the previous image can't help either.
    pub fn exited(&mut self, exit: ExitEvent, now: DateTime<Utc>) -> UpdateAction<Image> {
        let Stage::Trial { started } = self.stage else {
            return UpdateAction::Continue;
        };
        let in_trial = started.is_none_or(|started| now - started < TRIAL);
        let crashed = match exit.code.map(Exit::of) {
            None | Some(Exit::Crash(_) | Exit::InvalidSetting) => true,
            Some(
                Exit::Stopped | Exit::Restart | Exit::BadConfiguration | Exit::IncompatibleRuntime,
            ) => false,
        };
        // A first image has nothing to go back to: its crashes are the
        // supervisor's to back off.
        if exit.requested || !in_trial || !crashed || self.previous.is_none() {
            return UpdateAction::Continue;
        }
        self.roll_back(UpdateFailure::CrashLoop)
    }

    fn roll_back(&mut self, reason: UpdateFailure) -> UpdateAction<Image> {
        let Some(previous) = self.previous.clone() else {
            self.stage = Stage::RolledBack { reason };
            return UpdateAction::Fail(reason);
        };
        self.next = previous.clone();
        self.stage = Stage::RolledBack { reason };
        UpdateAction::Run {
            image: previous,
            status: UpdateStatus::RolledBack(reason),
        }
    }
}
