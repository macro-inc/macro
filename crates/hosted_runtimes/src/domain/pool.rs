//! The warm pool: booted, enrolled computers no team owns yet, so a purchase
//! takes one in a transaction instead of waiting for a guest to be created
//! and boot. [`plan`] is pure: given the pool computers on a host, what to
//! drain and what to create. The operator carries the plan out; creation
//! goes through the fleet port like any other computer's.

use crate::domain::ids::ComputerId;
use crate::domain::image::{GuestImage, GuestImages};
use crate::domain::lifecycle::Phase;
use crate::domain::models::Computer;
use crate::domain::size::ComputerSize;

#[cfg(test)]
mod test;

/// Which guest a pool computer is: the regular one, or the agent-mode build
/// an agent teammate's computer runs. A purchase takes only its own kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::EnumIter)]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "hosted_runtime_pool_kind", rename_all = "snake_case")
)]
pub enum PoolKind {
    /// For computers that run no agent teammate.
    Regular,
    /// Built from the agent image, waiting for the agent a purchase brings.
    Agent,
}

impl PoolKind {
    /// The kind a purchase takes: the agent kind when it is for an agent.
    pub fn for_purchase(agent: bool) -> Self {
        if agent { Self::Agent } else { Self::Regular }
    }

    /// The image this kind is created from.
    pub fn image<Image>(self, images: &GuestImages<Image>) -> &Image {
        match self {
            Self::Regular => &images.regular,
            Self::Agent => &images.agent,
        }
    }
}

/// How many pool computers each host keeps per size. Zero disables a size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoolTargets {
    /// Standard computers per host.
    pub standard: u32,
    /// Large computers per host.
    pub large: u32,
    /// XL computers per host.
    pub xl: u32,
}

impl PoolTargets {
    /// No pool: every purchase creates its computer.
    pub const NONE: Self = Self {
        standard: 0,
        large: 0,
        xl: 0,
    };

    /// How many pool computers of `size` a host keeps.
    pub fn target(self, size: ComputerSize) -> u32 {
        match size {
            ComputerSize::Standard => self.standard,
            ComputerSize::Large => self.large,
            ComputerSize::Xl => self.xl,
        }
    }
}

/// What to do with one host's pool.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PoolPlan {
    /// Pool computers to destroy: created from another image, or given up.
    pub drain: Vec<ComputerId>,
    /// Sizes to create one pool computer of, once per missing computer.
    pub create: Vec<ComputerSize>,
}

/// Plan one host's pool. `members` are its live pool computers and `image`
/// the one the host creates computers from. A member on another image, one
/// that gave up or one that is off is drained; members still being created
/// (no image yet) count toward the target, so a pass never creates twice.
/// Extra members beyond a lowered target are drained too.
pub fn plan(targets: PoolTargets, image: &GuestImage, members: &[Computer]) -> PoolPlan {
    let mut plan = PoolPlan::default();
    let mut kept = std::collections::HashMap::<ComputerSize, u32>::new();

    for member in members {
        let stale = member.image.as_ref().is_some_and(|built| built != image);
        let unusable = matches!(
            member.state.phase,
            Phase::Crashed { retry: None, .. } | Phase::Stopping | Phase::Stopped
        );
        let count = kept.entry(member.size).or_default();
        if stale || unusable || *count >= targets.target(member.size) {
            plan.drain.push(member.id);
        } else {
            *count += 1;
        }
    }

    for size in <ComputerSize as strum::IntoEnumIterator>::iter() {
        let have = kept.get(&size).copied().unwrap_or(0);
        for _ in have..targets.target(size) {
            plan.create.push(size);
        }
    }
    plan
}
