//! Resolution through a chain of policies, and the snapshot a detach copies.
//!
//! The root (the last level) resolves as a policy that owns its settings
//! does, or, when its source was lost, asks for everything. Each level from
//! the root back toward the policy can only restrict that: every row of a
//! level that follows a source is a restriction, the stricter of what the
//! levels after it give and its own rows covering the target (the action's
//! default, the group's action, the operation). The session overlay comes
//! last and also only restricts.
//!
//! An agent's restrictions on itself (`via_agent` rows) stay its own: they
//! apply to the policy that holds them and to no follower of it, as a
//! follower's own restrictions stay local to the follower
//! ([`Layer::as_source`]).

#[cfg(test)]
mod test;

use agent_permission_registry::Action;
use chrono::Utc;

use super::{Found, Layer, Setting, overlay_entry, own_default, own_entry, own_pair, with_overlay};
use crate::domain::model::{
    Catalog, CatalogEntry, Origin, PermissionState, PolicyChain, Rule, Target,
};

/// A state as the chain gives it, and the level that gave it.
#[derive(Debug, Clone, Copy)]
struct Winner {
    found: Found,
    /// Its level: 0 for the policy itself.
    level: usize,
}

/// The stricter of `candidates`, the first of equally strict ones: callers
/// list the most specific first.
fn strictest(candidates: impl IntoIterator<Item = Option<Found>>) -> Option<Found> {
    candidates
        .into_iter()
        .flatten()
        .fold(None, |best: Option<Found>, found| match best {
            Some(best) if best.state >= found.state => Some(best),
            Some(_) | None => Some(found),
        })
}

/// A following level's row on `action`'s default.
fn restrict_default(layer: &Layer, action: Action) -> Option<Found> {
    layer
        .action_setting(action)
        .map(|setting| Found::row(setting, Origin::Action))
}

/// A following level's rows on `group`'s `action`: its exception and the
/// action's default.
fn restrict_pair(layer: &Layer, group: &str, action: Action) -> Option<Found> {
    strictest([
        layer
            .group_action(group, action)
            .map(|setting| Found::row(setting, Origin::GroupAction)),
        restrict_default(layer, action),
    ])
}

/// A following level's rows on `entry`: the operation's, its group's action
/// and the action's default.
fn restrict_entry(layer: &Layer, entry: &CatalogEntry) -> Option<Found> {
    strictest([
        layer
            .tool(entry)
            .map(|setting| Found::row(setting, Origin::Tool)),
        restrict_pair(layer, &entry.group, entry.action),
    ])
}

/// A policy chain and a session's overlay, indexed for resolution.
#[derive(Debug)]
pub struct Resolver<'a> {
    /// `levels[0]` is the policy, the last its root; never empty.
    levels: Vec<Layer<'a>>,
    /// The root's source was lost: everything starts from ask.
    lost: bool,
    overlay: Layer<'a>,
}

impl<'a> Resolver<'a> {
    /// Resolve through `chain`, under `overlay` (empty for no session).
    pub fn new(chain: &'a PolicyChain, overlay: &'a [Rule]) -> Self {
        Self::with_rules(chain, chain.rules(), overlay)
    }

    /// Resolve through `chain` with the policy's own settings read from
    /// `rules` instead: how the chain resolves once a write lands.
    pub fn with_rules(chain: &'a PolicyChain, rules: &'a [Rule], overlay: &'a [Rule]) -> Self {
        let levels = std::iter::once(Layer::new(rules))
            .chain(
                chain
                    .sources()
                    .iter()
                    .map(|level| Layer::as_source(&level.rules)),
            )
            .collect();
        Self {
            levels,
            lost: chain.lost(),
            overlay: Layer::new(overlay),
        }
    }

    /// Resolve a policy that owns `rules`, under `overlay`.
    pub fn own(rules: &'a [Rule], overlay: &'a [Rule]) -> Self {
        Self {
            levels: vec![Layer::new(rules)],
            lost: false,
            overlay: Layer::new(overlay),
        }
    }

    /// The chain's state from the root toward the policy: `root` resolves
    /// the root as an own policy; `restrict` is each following level's rows.
    fn fold(
        &self,
        root: impl Fn(&Layer) -> Found,
        restrict: impl Fn(&Layer) -> Option<Found>,
    ) -> Winner {
        let mut winner: Option<Winner> = None;
        for (level, layer) in self.levels.iter().enumerate().rev() {
            let current = match winner {
                Some(current) => current,
                None if self.lost => Winner {
                    found: Found {
                        state: PermissionState::Ask,
                        origin: Origin::Source,
                        row: None,
                    },
                    level,
                },
                None => {
                    winner = Some(Winner {
                        found: root(layer),
                        level,
                    });
                    continue;
                }
            };
            winner = Some(match restrict(layer) {
                Some(found) if found.state > current.found.state => Winner { found, level },
                Some(_) | None => current,
            });
        }
        // `levels` is never empty, so the loop always sets it.
        winner.unwrap_or(Winner {
            found: Found {
                state: PermissionState::Ask,
                origin: Origin::Source,
                row: None,
            },
            level: 0,
        })
    }

    /// Where a state the chain gave comes from: its row's kind when the
    /// policy's own row gave it, else the source.
    fn origin(winner: Winner) -> (PermissionState, Origin) {
        let origin = if winner.level == 0 {
            winner.found.origin
        } else {
            Origin::Source
        };
        (winner.found.state, origin)
    }

    fn saved_default(&self, action: Action) -> Winner {
        self.fold(
            |layer| own_default(layer, action),
            |layer| restrict_default(layer, action),
        )
    }

    fn saved_pair(&self, group: &str, action: Action) -> Winner {
        self.fold(
            |layer| own_pair(layer, group, action),
            |layer| restrict_pair(layer, group, action),
        )
    }

    fn saved_entry(&self, entry: &CatalogEntry) -> Winner {
        self.fold(
            |layer| own_entry(layer, entry),
            |layer| restrict_entry(layer, entry),
        )
    }

    /// `action`'s default, and where it comes from.
    pub fn default(&self, action: Action) -> (PermissionState, Origin) {
        with_overlay(
            Self::origin(self.saved_default(action)),
            self.overlay.action(action),
        )
    }

    /// `group`'s `action`, ignoring operations' own settings, and where it
    /// comes from. The same whether or not an operation maps there.
    pub fn pair(&self, group: &str, action: Action) -> (PermissionState, Origin) {
        with_overlay(
            Self::origin(self.saved_pair(group, action)),
            self.overlay.restriction(group, action),
        )
    }

    /// `entry`'s effective state, and where it comes from.
    pub fn entry(&self, entry: &CatalogEntry) -> (PermissionState, Origin) {
        with_overlay(
            Self::origin(self.saved_entry(entry)),
            overlay_entry(&self.overlay, entry),
        )
    }

    /// `group`'s `action` as it would be without the policy's own exception
    /// there: the action's default for a policy that owns its settings, what
    /// its source gives (with its other own rows) for a follower. The
    /// overlay's default applies, as it does to the default.
    pub fn pair_without_own_exception(
        &self,
        group: &str,
        action: Action,
    ) -> (PermissionState, Origin) {
        let mut levels = self.levels.clone();
        if let Some(own) = levels.first_mut() {
            own.remove_exception(group, action);
        }
        let without = Resolver {
            levels,
            lost: self.lost,
            overlay: Layer::default(),
        };
        with_overlay(
            Self::origin(without.saved_pair(group, action)),
            self.overlay.action(action),
        )
    }

    /// Whether the policy itself holds an exception for `group`'s `action`.
    pub fn has_own_exception(&self, group: &str, action: Action) -> bool {
        self.levels
            .first()
            .is_some_and(|layer| layer.has_exception(group, action))
    }

    /// Whether any level holds an exception for `group`'s `action`.
    pub fn has_exception(&self, group: &str, action: Action) -> bool {
        self.levels
            .iter()
            .any(|layer| layer.has_exception(group, action))
    }

    /// Whether `winner` is a person's row on the root, which owns its
    /// settings: an explicit choice a snapshot keeps as one.
    fn persons_root_row(&self, winner: Winner) -> bool {
        !self.lost
            && winner.level + 1 == self.levels.len()
            && winner
                .found
                .row
                .is_some_and(|setting| !setting.restriction_only)
    }
}

/// A row for `target` in `state`, marked as a restriction or a person's.
fn snapshot_row(
    target: Target,
    state: PermissionState,
    restriction_only: bool,
    via_agent: bool,
) -> Rule {
    Rule {
        target,
        state,
        // Only a restriction can be the agent's (the table's check).
        via_agent: via_agent && restriction_only,
        restriction_only,
        updated_at: Utc::now(),
    }
}

/// The settings a policy that owns them would need to resolve exactly as
/// `chain` does now: every action's default, every group's every action
/// (the registry's groups and any a level's rows name, pairs no operation
/// maps to included) and every catalog operation. Session overlays are not
/// part of a chain, so nothing in them is copied; nor are one-time and
/// session approvals, which are not permission rows at all, nor a source's
/// restrictions on itself, which never applied to the follower.
///
/// - A default is kept when it is not always.
/// - A group's action is kept wherever any level has an exception (an
///   explicit choice stays one, even when equal to the default) or it
///   differs from its default. It is a person's row when the root's
///   person's exception gave it or it is looser than the default, else a
///   restriction.
/// - An operation's row is kept when its state differs from its group's
///   action, when the root's person's row gave it, or when the policy itself
///   has one (its local restriction stays local). It is a restriction unless
///   it is that person's row or looser than its group's action.
///
/// Rows naming an operation the catalog no longer has are dropped: they
/// resolve to nothing.
pub fn materialize(catalog: &Catalog, chain: &PolicyChain) -> Vec<Rule> {
    let resolver = Resolver::new(chain, &[]);
    let mut rules = Vec::new();

    let mut groups: Vec<&str> = catalog
        .groups
        .iter()
        .map(|group| group.id.as_str())
        .collect();
    for level in chain.levels() {
        for rule in &level.rules {
            if let Target::GroupAction { group, .. } = &rule.target
                && !groups.contains(&group.as_str())
            {
                groups.push(group);
            }
        }
    }

    for action in Action::ALL {
        let default = resolver.saved_default(action);
        if default.found.state != PermissionState::Always {
            let row = default.found.row;
            rules.push(snapshot_row(
                Target::Action { action },
                default.found.state,
                row.is_some_and(|setting| setting.restriction_only),
                row.is_some_and(|setting| setting.via_agent),
            ));
        }
        for group in &groups {
            let pair = resolver.saved_pair(group, action);
            if !resolver.has_exception(group, action) && pair.found.state == default.found.state {
                continue;
            }
            let persons =
                resolver.persons_root_row(pair) && pair.found.origin == Origin::GroupAction;
            let restriction_only = pair.found.state >= default.found.state && !persons;
            rules.push(snapshot_row(
                Target::GroupAction {
                    group: (*group).to_owned(),
                    action,
                },
                pair.found.state,
                restriction_only,
                pair.found.row.is_some_and(|setting| setting.via_agent),
            ));
        }
    }

    let own = resolver.levels.first();
    for entry in &catalog.entries {
        let state = resolver.saved_entry(entry);
        let pair = resolver.saved_pair(&entry.group, entry.action).found.state;
        let local: Option<Setting> = own.and_then(|layer| layer.tool(entry));
        let persons = resolver.persons_root_row(state) && state.found.origin == Origin::Tool;
        if state.found.state == pair && !persons && local.is_none() {
            continue;
        }
        // Labelled the agent's only when the agent's row gives the state: a
        // follower's own Ask under its source's Never is not the agent's
        // Never, but its own Never under the source's Never is.
        let via_agent = state.found.row.is_some_and(|setting| setting.via_agent)
            || local.is_some_and(|setting| setting.via_agent && setting.state == state.found.state);
        rules.push(snapshot_row(
            Target::Tool {
                service: entry.service.clone(),
                operation: entry.operation.clone(),
            },
            state.found.state,
            state.found.state >= pair && !persons,
            via_agent,
        ));
    }
    rules
}
