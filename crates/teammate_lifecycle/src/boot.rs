//! What `teammate-boot` decides at each start, as pure functions: it
//! replaces `start-agent` and `agent-stopped`.
//!
//! A start goes through three decisions:
//!
//! 1. [`count_previous`]: the previous run's exit counts as a failed boot of
//!    the code it ran, or not (what `agent-stopped` did after each stop).
//! 2. [`admit`]: whether this start goes ahead, before the workspace is
//!    touched: 77 when retrying the settings can't help, 78 for settings
//!    that are wrong now.
//! 3. [`plan_boot`]: from facts about the checked-out code, its last-good
//!    and the image, the steps to take (roll back, adopt the image's lock,
//!    link its packages) and whether the runtime starts.

use std::fmt;

use crate::exit::{self, Exit, PreviousExit};

#[cfg(test)]
mod test;

/// Failed boots of one head after which the next start rolls back to
/// last-good.
pub const MAX_FAILED_BOOTS: u32 = 3;

/// A git commit id: 40 or 64 lowercase hex digits.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CommitId(String);

/// Text that isn't a commit id.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not a commit id")]
pub struct InvalidCommitId;

impl CommitId {
    /// `value`, if it is a commit id.
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidCommitId> {
        let value = value.into();
        let valid = lazy_regex::regex_is_match!(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$", &value);
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidCommitId)
        }
    }

    /// The hex digits.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The first 12 digits, as messages show it.
    pub fn short(&self) -> &str {
        self.0.get(..12).unwrap_or(&self.0)
    }
}

impl fmt::Display for CommitId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The boot state files, kept in the agent's volume across runs and
/// images: `failed-boots`, `boot-head` and `last-good` (which the runtime
/// writes after a healthy boot).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BootState {
    /// Failed boots of the code since its last healthy boot or rollback.
    pub failed_boots: u32,
    /// The head the last boot ran, written before anything could fail it.
    pub boot_head: Option<CommitId>,
    /// The head of the last healthy boot.
    pub last_good: Option<CommitId>,
}

impl BootState {
    /// Whether the last boot ran last-good's code.
    pub fn last_boot_on_last_good(&self) -> bool {
        self.boot_head.is_some() && self.boot_head == self.last_good
    }
}

/// The failed-boot count after the previous run. Any end of last-good's
/// code starts the count again: what failed before was other code. Else a
/// crash or a bad setting counts; a stop, a restart after a land and a
/// terminal code don't. An exit the supervisor didn't see counts once when
/// the boot it ended never became healthy, so a lost exit never hides a
/// crash, and the next boot records its own head before it can fail, so it
/// is never counted twice.
pub fn count_previous(state: &BootState, previous: PreviousExit) -> u32 {
    if state.last_boot_on_last_good() {
        return 0;
    }
    let counts = match previous {
        PreviousExit::Unknown => state.boot_head.is_some(),
        PreviousExit::Exited { code } => Exit::of(code).counts_as_failed_boot(),
    };
    if counts {
        state.failed_boots.saturating_add(1)
    } else {
        state.failed_boots
    }
}

/// A setting in `agent.env` that is missing or invalid.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SettingsProblem {
    /// The credentials file can't be read.
    #[error("the credentials file can't be read")]
    Unreadable,
    /// A required setting is absent or empty.
    #[error("agent.env is missing {0}")]
    Missing(&'static str),
    /// `MACRO_AGENT_USER_ID` isn't `macro|<email>`.
    #[error("MACRO_AGENT_USER_ID must contain the agent email (macro|email)")]
    UserIdWithoutEmail,
    /// `MACRO_REPO_URL` isn't HTTP(S), or carries credentials.
    #[error("MACRO_REPO_URL must be an HTTP(S) URL without credentials")]
    RepoUrlNotHttp,
}

/// Why a boot ends without starting the runtime. Each has one exit code.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BootExit {
    /// The last run exited 78 with nothing a rollback could fix: on
    /// last-good, with no last-good, or on settings that are still wrong.
    #[error(
        "the last start found a bad setting and a rollback can't fix it: the settings are wrong, not the code"
    )]
    SettingsWrongNotCode,
    /// A setting is wrong now.
    #[error("{0}")]
    InvalidSetting(SettingsProblem),
    /// The code changed its dependencies, so the image's packages don't
    /// fit, and no last-good has the template's: new packages need a new
    /// image.
    #[error(
        "bun.lock differs from the image's and the agent changed its dependencies; new packages need a new image"
    )]
    DependenciesChanged,
    /// The code's package.json `muppetApi` isn't a whole number.
    #[error("package.json's muppetApi must be a whole number")]
    GarbledNeed,
    /// The image's muppet `apiLevel` isn't a whole number.
    #[error("the image's muppet apiLevel must be a whole number")]
    GarbledImageLevel,
    /// The code needs a newer muppet than the image's, and no last-good
    /// would run here.
    #[error(
        "this agent needs a newer image: its code needs muppet API {needs}, the image has {has}"
    )]
    NeedsNewerImage {
        /// The API level the code needs.
        needs: u64,
        /// The image's.
        has: u64,
    },
}

impl BootExit {
    /// The exit code this ends the boot with.
    pub fn code(&self) -> u8 {
        match self {
            Self::SettingsWrongNotCode => exit::BAD_CONFIGURATION,
            Self::InvalidSetting(_) | Self::GarbledNeed | Self::GarbledImageLevel => {
                exit::INVALID_SETTING
            }
            Self::DependenciesChanged | Self::NeedsNewerImage { .. } => exit::INCOMPATIBLE_RUNTIME,
        }
    }
}

/// Whether a start goes ahead, from the state before [`count_previous`]
/// and this start's settings.
///
/// A 78 is retried once, in case it passes. It ends in 77 the next time
/// when no rollback can fix it: the last boot was last-good's (the settings
/// are wrong, not the code), there is no last-good, or `agent.env` itself
/// is still wrong (it isn't code). A 78 on other code is counted instead,
/// so that code rolls back.
pub fn admit(
    state: &BootState,
    previous: PreviousExit,
    settings: &Result<(), SettingsProblem>,
) -> Result<(), BootExit> {
    let previous_invalid = previous
        == PreviousExit::Exited {
            code: exit::INVALID_SETTING,
        };
    let nothing_to_roll_back = state.last_good.is_none() || state.last_boot_on_last_good();
    if previous_invalid && (nothing_to_roll_back || settings.is_err()) {
        return Err(BootExit::SettingsWrongNotCode);
    }
    settings.clone().map_err(BootExit::InvalidSetting)
}

/// A value from a package.json that isn't a whole number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Garbled;

/// What one commit's code needs from the image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeFacts {
    /// The muppet API level it needs (`muppetApi`, 0 when absent).
    pub needs: Result<u64, Garbled>,
    /// Whether its `bun.lock` is the image's.
    pub lock_matches_image: bool,
    /// Whether its package.json's dependency fields differ from the
    /// template's (the repository's first commit).
    pub dependencies_edited: bool,
}

/// What [`plan_boot`] decides from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootInput {
    /// Failed boots, after [`count_previous`].
    pub failed_boots: u32,
    /// The checked-out head.
    pub head: CommitId,
    /// Its code, as checked out (uncommitted changes count).
    pub head_code: CodeFacts,
    /// Last-good and its code, when there is one.
    pub last_good: Option<(CommitId, CodeFacts)>,
    /// The image's muppet API level (`apiLevel`, 0 when absent).
    pub image_level: Result<u64, Garbled>,
}

/// Why the code goes back to last-good.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RollbackReason {
    /// The head failed this many boots.
    FailedBoots {
        /// Failed boots.
        count: u32,
    },
    /// The head changed its dependencies, and last-good has the
    /// template's.
    DependenciesChanged,
    /// The head needs a newer muppet than the image's, and last-good runs
    /// on it.
    NeedsNewerImage {
        /// The API level the head needs.
        needs: u64,
        /// The image's.
        has: u64,
    },
}

/// One step of a boot, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootStep {
    /// Commit last-good's tree on top of the head and check it out, so the
    /// runtime's next `pull --rebase` keeps it. The rollback becomes
    /// last-good, and the count starts again.
    RollBack {
        /// Last-good.
        to: CommitId,
        /// Why.
        reason: RollbackReason,
    },
    /// Write the checked-out head to `boot-head`, so the next start counts
    /// a failure of this boot against it.
    RecordBootHead,
    /// Copy the image's `bun.lock` over the workspace's and commit it.
    AdoptLock,
    /// Point the workspace's `node_modules` at the image's.
    LinkModules,
}

/// What a boot does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootPlan {
    /// The steps, in order.
    pub steps: Vec<BootStep>,
    /// Then start the runtime, or exit.
    pub end: Result<(), BootExit>,
}

/// Plan a boot whose start was admitted. The order is `start-agent`'s:
/// roll back after [`MAX_FAILED_BOOTS`], record the boot head, adopt the
/// image's lock, link the packages, then compare muppet levels. Code that
/// changed its dependencies, or needs a newer muppet, rolls back in the
/// same boot to a last-good that fits; with none, the boot exits 79. A boot
/// rolls back at most once.
pub fn plan_boot(input: &BootInput) -> BootPlan {
    let mut steps = Vec::new();
    let last_good = input
        .last_good
        .as_ref()
        .filter(|(commit, _)| *commit != input.head);

    let mut code = &input.head_code;
    let mut rolled_back = false;
    if input.failed_boots >= MAX_FAILED_BOOTS
        && let Some((good, good_code)) = last_good
    {
        steps.push(BootStep::RollBack {
            to: good.clone(),
            reason: RollbackReason::FailedBoots {
                count: input.failed_boots,
            },
        });
        code = good_code;
        rolled_back = true;
    }

    if let Err(end) = prepare(&mut steps, code) {
        // New packages: last-good, if it has the template's, runs instead.
        let fitting_last_good = last_good
            .filter(|_| !rolled_back)
            .filter(|(_, good_code)| !good_code.dependencies_edited);
        let Some((good, good_code)) = fitting_last_good else {
            return BootPlan {
                steps,
                end: Err(end),
            };
        };
        steps.push(BootStep::RollBack {
            to: good.clone(),
            reason: RollbackReason::DependenciesChanged,
        });
        code = good_code;
        rolled_back = true;
        if let Err(end) = prepare(&mut steps, code) {
            return BootPlan {
                steps,
                end: Err(end),
            };
        }
    }
    steps.push(BootStep::LinkModules);

    let Ok(needs) = code.needs else {
        return BootPlan {
            steps,
            end: Err(BootExit::GarbledNeed),
        };
    };
    let Ok(has) = input.image_level else {
        return BootPlan {
            steps,
            end: Err(BootExit::GarbledImageLevel),
        };
    };
    if needs <= has {
        return BootPlan { steps, end: Ok(()) };
    }

    // Too new for the image: last-good, if it fits, runs instead.
    let fitting_last_good = last_good
        .filter(|_| !rolled_back)
        .filter(|(_, good_code)| good_code.needs.is_ok_and(|good_needs| good_needs <= has));
    let Some((good, good_code)) = fitting_last_good else {
        return BootPlan {
            steps,
            end: Err(BootExit::NeedsNewerImage { needs, has }),
        };
    };
    steps.push(BootStep::RollBack {
        to: good.clone(),
        reason: RollbackReason::NeedsNewerImage { needs, has },
    });
    let end = prepare(&mut steps, good_code);
    BootPlan { steps, end }
}

/// Record the boot head, then adopt the image's lock unless the code
/// changed its dependencies.
fn prepare(steps: &mut Vec<BootStep>, code: &CodeFacts) -> Result<(), BootExit> {
    steps.push(BootStep::RecordBootHead);
    if code.lock_matches_image {
        return Ok(());
    }
    if code.dependencies_edited {
        return Err(BootExit::DependenciesChanged);
    }
    steps.push(BootStep::AdoptLock);
    steps.push(BootStep::RecordBootHead);
    Ok(())
}
