//! Resolution: what state each operation has under a policy's saved settings
//! and a session's overlay, the view built from it, and the tighten-only rule.
//!
//! Each action has a default (`Target::Action`, else always). A group's
//! action takes its exception (`Target::GroupAction`) if a person made one,
//! else the default; an exception not made by a signed-in person (the agent
//! restricting itself, an API key) only adds to the default, taking the
//! stricter of the two. An operation takes its own setting if a person made
//! it, else its group's action; one not made by a person again only adds,
//! so a person's later, stricter group or default setting still applies to
//! it. The session overlay is the agent's too and can only add restrictions:
//! the effective state is the stricter of the saved state and each of the
//! overlay's rows that cover it. Nothing is inferred: a new operation takes
//! its group's action and a new group has no exceptions, so it follows each
//! action's default.
//!
//! A policy that follows another resolves through its chain of sources
//! instead, its own rows only restricting what the chain gives (`chain`'s
//! [`Resolver`]); [`materialize`] is the snapshot a detach copies.

mod chain;
#[cfg(test)]
mod test;

pub use chain::{Resolver, materialize};

use std::collections::HashMap;

use agent_permission_registry::Action;
use bot_id::BotId;
use chrono::Utc;

use super::model::{
    Catalog, CatalogEntry, Change, LoosenedOperation, Origin, PermissionState, PermissionsView,
    PolicyChain, PolicyKind, Rule, SetBy, Target, ToolPermissionAction, ToolPermissionCatalog,
    ToolPermissionCatalogAction, ToolPermissionCatalogGroup, ToolPermissionDefault,
    ToolPermissionGroup, ToolPermissionOverride,
};

/// One layer of settings (saved, or a session's overlay), indexed for lookup.
#[derive(Debug, Clone, Default)]
pub struct Layer<'a> {
    actions: HashMap<Action, Setting>,
    group_actions: HashMap<(&'a str, Action), Setting>,
    tools: HashMap<(&'a str, &'a str), Setting>,
}

/// A saved row's state, whether it only restricts, and whether the agent
/// set it.
#[derive(Debug, Clone, Copy)]
struct Setting {
    state: PermissionState,
    restriction_only: bool,
    via_agent: bool,
}

impl<'a> Layer<'a> {
    /// Index `rules`.
    pub fn new(rules: &'a [Rule]) -> Self {
        Self::of(rules.iter())
    }

    /// Index `rules` as a source a follower resolves through: an agent's
    /// restrictions on itself (`via_agent`) stay its own, as a follower's
    /// stay local to the follower, so they are left out.
    pub fn as_source(rules: &'a [Rule]) -> Self {
        Self::of(rules.iter().filter(|rule| !rule.via_agent))
    }

    fn of(rules: impl Iterator<Item = &'a Rule>) -> Self {
        let mut layer = Layer::default();
        for rule in rules {
            let setting = Setting {
                state: rule.state,
                restriction_only: rule.restriction_only,
                via_agent: rule.via_agent,
            };
            match &rule.target {
                Target::Action { action } => {
                    layer.actions.insert(*action, setting);
                }
                Target::GroupAction { group, action } => {
                    layer
                        .group_actions
                        .insert((group.as_str(), *action), setting);
                }
                Target::Tool { service, operation } => {
                    layer
                        .tools
                        .insert((service.as_str(), operation.as_str()), setting);
                }
            }
        }
        layer
    }

    fn action(&self, action: Action) -> Option<PermissionState> {
        self.action_setting(action).map(|setting| setting.state)
    }

    fn action_setting(&self, action: Action) -> Option<Setting> {
        self.actions.get(&action).copied()
    }

    fn group_action(&self, group: &str, action: Action) -> Option<Setting> {
        self.group_actions.get(&(group, action)).copied()
    }

    /// The layer without its exception for `group`'s `action`.
    fn remove_exception(&mut self, group: &str, action: Action) {
        self.group_actions
            .retain(|(held, held_action), _| !(*held == group && *held_action == action));
    }

    /// Whether the layer holds an exception for `group`'s `action`.
    fn has_exception(&self, group: &str, action: Action) -> bool {
        self.group_actions.contains_key(&(group, action))
    }

    fn tool(&self, entry: &CatalogEntry) -> Option<Setting> {
        self.tools
            .get(&(entry.service.as_str(), entry.operation.as_str()))
            .copied()
    }

    /// The stricter of this layer's rows covering `group`'s `action`: the
    /// overlay's, which only ever restrict.
    fn restriction(&self, group: &str, action: Action) -> Option<PermissionState> {
        self.action(action)
            .into_iter()
            .chain(
                self.group_action(group, action)
                    .map(|setting| setting.state),
            )
            .max()
    }
}

/// `base`, or the overlay's `extra` when it is stricter.
fn with_overlay(
    (base, origin): (PermissionState, Origin),
    extra: Option<PermissionState>,
) -> (PermissionState, Origin) {
    match extra {
        Some(extra) if extra > base => (extra, Origin::Session),
        Some(_) | None => (base, origin),
    }
}

/// A state found under one layer, where it comes from, and the row that
/// gave it (`None` when no row did: always, or a lost source's ask).
#[derive(Debug, Clone, Copy)]
struct Found {
    state: PermissionState,
    origin: Origin,
    row: Option<Setting>,
}

impl Found {
    fn row(setting: Setting, origin: Origin) -> Self {
        Self {
            state: setting.state,
            origin,
            row: Some(setting),
        }
    }

    fn pair(self) -> (PermissionState, Origin) {
        (self.state, self.origin)
    }
}

/// `action`'s default under `saved` alone, as a policy that owns its
/// settings has it.
fn own_default(saved: &Layer, action: Action) -> Found {
    match saved.action_setting(action) {
        Some(setting) => Found::row(setting, Origin::Action),
        None => Found {
            state: PermissionState::Always,
            origin: Origin::Default,
            row: None,
        },
    }
}

/// `group`'s `action` under `saved` alone: a person's exception replaces the
/// default; anyone else's only adds to it.
fn own_pair(saved: &Layer, group: &str, action: Action) -> Found {
    let default = own_default(saved, action);
    match saved.group_action(group, action) {
        Some(
            setting @ Setting {
                restriction_only: false,
                ..
            },
        ) => Found::row(setting, Origin::GroupAction),
        Some(
            setting @ Setting {
                restriction_only: true,
                ..
            },
        ) if setting.state > default.state => Found::row(setting, Origin::GroupAction),
        Some(_) | None => default,
    }
}

/// `entry` under `saved` alone: a person's setting on the operation
/// replaces its group's action; anyone else's (the agent's, an API key's)
/// only adds to it, so a stricter group setting still wins.
fn own_entry(saved: &Layer, entry: &CatalogEntry) -> Found {
    let pair = own_pair(saved, &entry.group, entry.action);
    match saved.tool(entry) {
        Some(
            setting @ Setting {
                restriction_only: false,
                ..
            },
        ) => Found::row(setting, Origin::Tool),
        Some(
            setting @ Setting {
                restriction_only: true,
                ..
            },
        ) if setting.state > pair.state => Found::row(setting, Origin::Tool),
        Some(_) | None => pair,
    }
}

/// The overlay's rows covering `entry`: all the agent's, so the stricter of
/// the operation's, its group's and the action's.
fn overlay_entry(overlay: &Layer, entry: &CatalogEntry) -> Option<PermissionState> {
    overlay
        .tool(entry)
        .map(|setting| setting.state)
        .into_iter()
        .chain(overlay.restriction(&entry.group, entry.action))
        .max()
}

/// The state of `action`'s default under `saved` and `overlay`, and where it
/// comes from.
pub fn default_state(saved: &Layer, overlay: &Layer, action: Action) -> (PermissionState, Origin) {
    with_overlay(own_default(saved, action).pair(), overlay.action(action))
}

/// The state of `group`'s `action` under `saved` and `overlay`, ignoring
/// operations' own settings, and where it comes from. The same whether or not
/// an operation maps there.
pub fn pair_state(
    saved: &Layer,
    overlay: &Layer,
    group: &str,
    action: Action,
) -> (PermissionState, Origin) {
    with_overlay(
        own_pair(saved, group, action).pair(),
        overlay.restriction(group, action),
    )
}

/// The effective state of `entry` under `saved` and `overlay`, and where it
/// comes from.
pub fn effective(
    saved: &Layer,
    overlay: &Layer,
    entry: &CatalogEntry,
) -> (PermissionState, Origin) {
    with_overlay(
        own_entry(saved, entry).pair(),
        overlay_entry(overlay, entry),
    )
}

/// Who may do what with a view, decided by the service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewAccess {
    /// May set and reset.
    pub can_edit: bool,
    /// May tighten.
    pub can_tighten: bool,
}

/// Each action's default, and every catalog group with the actions it has
/// operations for, resolved through `chain` and under `overlay` (`None` for
/// no session), in display order. A pair no operation maps to, and a group with
/// none, is left out: no setting there can change what the agent does. Its
/// saved rule stays in `rules` and applies as soon as an operation maps
/// there, since resolution never looks at the view.
pub fn view(
    catalog: &Catalog,
    agent_id: BotId,
    kind: PolicyKind,
    access: ViewAccess,
    chain: &PolicyChain,
    overlay: Option<Vec<Rule>>,
) -> PermissionsView {
    let resolver = Resolver::new(chain, overlay.as_deref().unwrap_or_default());

    let defaults = Action::DISPLAY
        .into_iter()
        .map(|action| {
            let (state, origin) = resolver.default(action);
            ToolPermissionDefault {
                action,
                state,
                origin,
            }
        })
        .collect();

    let mut restricted: u32 = 0;
    let mut groups = Vec::with_capacity(catalog.groups.len());
    for group in &catalog.groups {
        let mut actions = Vec::with_capacity(Action::DISPLAY.len());
        for action in Action::DISPLAY {
            let entries: Vec<&CatalogEntry> = catalog
                .entries
                .iter()
                .filter(|entry| entry.group == group.id && entry.action == action)
                .collect();
            if entries.is_empty() {
                continue;
            }
            let (state, origin) = resolver.pair(&group.id, action);
            let mut overrides = Vec::new();

            // An operation differs from its action only through its own
            // setting, saved or in the overlay.
            for entry in entries.iter().copied() {
                let (tool_state, tool_origin) = resolver.entry(entry);
                if tool_state != PermissionState::Always {
                    restricted += 1;
                }
                if tool_state != state {
                    overrides.push(ToolPermissionOverride {
                        service: entry.service.clone(),
                        operation: entry.operation.clone(),
                        label: entry.label.clone(),
                        state: tool_state,
                        origin: tool_origin,
                    });
                }
            }

            actions.push(ToolPermissionAction {
                action,
                state,
                origin,
                exception: resolver.has_own_exception(&group.id, action),
                tools: u32::try_from(entries.len()).unwrap_or(u32::MAX),
                overrides,
            });
        }
        if actions.is_empty() {
            continue;
        }
        groups.push(ToolPermissionGroup {
            group: group.id.clone(),
            actions,
        });
    }

    PermissionsView {
        agent_id,
        policy_id: chain.policy().id,
        kind,
        can_edit: access.can_edit,
        can_tighten: access.can_tighten,
        version: catalog.version.clone(),
        restricted,
        defaults,
        rules: chain.rules().to_vec(),
        session_rules: overlay,
        groups,
        can_set_source: false,
        source: None,
        inherited: None,
    }
}

/// The catalog as the API lists it.
pub fn catalog_view(catalog: &Catalog) -> ToolPermissionCatalog {
    ToolPermissionCatalog {
        version: catalog.version.clone(),
        actions: Action::DISPLAY
            .into_iter()
            .map(|action| {
                let (name, description) = action_text(action);
                ToolPermissionCatalogAction {
                    action,
                    name,
                    description,
                }
            })
            .collect(),
        groups: catalog
            .groups
            .iter()
            .map(|group| ToolPermissionCatalogGroup {
                id: group.id.clone(),
                name: group.name.clone(),
                description: group.description.clone(),
                tools: catalog
                    .entries
                    .iter()
                    .filter(|entry| entry.group == group.id)
                    .cloned()
                    .collect(),
            })
            .collect(),
    }
}

/// An action's display name and description.
fn action_text(action: Action) -> (&'static str, &'static str) {
    match action {
        Action::Create => ("Create", "Makes something new."),
        Action::Read => ("Read", "Reads, lists or searches; changes nothing."),
        Action::Update => ("Edit", "Changes something that exists."),
        Action::Destroy => ("Delete", "Deletes or permanently removes something."),
        Action::Send => (
            "Send",
            "Reaches other people: sends a message or email, invites, shares.",
        ),
    }
}

/// The targets among `changes` the catalog does not know.
pub fn unknown_targets(catalog: &Catalog, changes: &[Change]) -> Vec<Target> {
    changes
        .iter()
        .map(|change| &change.target)
        .filter(|target| match target {
            Target::Action { .. } => false,
            Target::GroupAction { group, .. } => catalog.group(group).is_none(),
            Target::Tool { service, operation } => catalog.entry(service, operation).is_none(),
        })
        .cloned()
        .collect()
}

/// Whether a write keeps `state` for `target`. An action's default is never
/// stored as always (what no default means). A person's always on a group's
/// action or an operation is kept: an explicit exception. A restriction (a
/// tightening, or an overlay) never stores always at all: it loosens nothing
/// and would only hide a later, stricter default or group setting.
fn stores(target: &Target, state: PermissionState, restriction: bool) -> bool {
    match target {
        Target::Action { .. } => state != PermissionState::Always,
        Target::GroupAction { .. } | Target::Tool { .. } => {
            !restriction || state != PermissionState::Always
        }
    }
}

/// The changes as the store applies them: a state the write does not keep
/// becomes a removal. A target named twice keeps its last change.
pub fn normalize(changes: Vec<Change>, restriction: bool) -> Vec<Change> {
    let mut normalized: Vec<Change> = Vec::with_capacity(changes.len());
    for change in changes {
        normalized.retain(|earlier| earlier.target != change.target);
        normalized.push(Change {
            state: change
                .state
                .filter(|state| stores(&change.target, *state, restriction)),
            target: change.target,
        });
    }
    normalized
}

/// `rules` with normalized `changes` applied, as the store will hold them,
/// for resolving before anything is saved, marked as `set_by` will mark
/// them. New rules are stamped now, which resolution ignores.
pub fn apply(rules: &[Rule], changes: &[Change], set_by: SetBy) -> Vec<Rule> {
    let now = Utc::now();
    let mut applied: Vec<Rule> = rules.to_vec();
    for change in changes {
        applied.retain(|rule| rule.target != change.target);
        if let Some(state) = change.state {
            applied.push(Rule {
                target: change.target.clone(),
                state,
                via_agent: set_by.via_agent(),
                restriction_only: set_by.restriction_only(),
                updated_at: now,
            });
        }
    }
    applied
}

/// Refuses a change that makes anything more permissive: compares, `before`
/// and `after` (the chain and the overlay as they stand, and as they will),
/// every operation's effective state, every catalog group's every action
/// (including pairs no operation maps to yet) and every action's default.
/// One pointwise rule, so no combination of settings can loosen anything,
/// today or once the registry maps a new operation. Only operations are
/// named; a change that loosens only a pair or a default is refused with
/// none.
pub fn tighten_only(
    catalog: &Catalog,
    before: &Resolver,
    after: &Resolver,
) -> Result<(), Vec<LoosenedOperation>> {
    let loosened: Vec<LoosenedOperation> = catalog
        .entries
        .iter()
        .filter_map(|entry| {
            let (from, _) = before.entry(entry);
            let (to, _) = after.entry(entry);
            (to < from).then(|| loosened(entry, from, to))
        })
        .collect();
    let loosens_a_default = Action::ALL
        .into_iter()
        .any(|action| after.default(action).0 < before.default(action).0);
    let loosens_a_pair = catalog.groups.iter().any(|group| {
        Action::ALL
            .into_iter()
            .any(|action| after.pair(&group.id, action).0 < before.pair(&group.id, action).0)
    });
    if loosened.is_empty() && !loosens_a_default && !loosens_a_pair {
        Ok(())
    } else {
        Err(loosened)
    }
}

fn loosened(entry: &CatalogEntry, from: PermissionState, to: PermissionState) -> LoosenedOperation {
    LoosenedOperation {
        service: entry.service.clone(),
        operation: entry.operation.clone(),
        label: entry.label.clone(),
        from,
        to,
    }
}

/// Refuses a change that asks for a state looser than its target has now:
/// an operation's own state looser than its effective state, a group's
/// action looser than its state (removing its exception asks for the
/// action's default), or a default looser than it is (removing it asks for
/// always). The agent's setting on an operation only adds to its group's, so
/// the first would be saved as a no-op; the others would drop a person's
/// setting even where no operation's state moves today (each operation has
/// its own setting, or no operation maps there yet), and every operation
/// resolving through it later would be looser. All are refused, naming the
/// operations that resolve through the target now.
pub fn asks_looser(
    catalog: &Catalog,
    now: &Resolver,
    changes: &[Change],
) -> Result<(), Vec<LoosenedOperation>> {
    let mut refused = false;
    let mut operations: Vec<LoosenedOperation> = Vec::new();
    for change in changes {
        match &change.target {
            Target::Tool { service, operation } => {
                let (Some(to), Some(entry)) = (change.state, catalog.entry(service, operation))
                else {
                    continue;
                };
                let (from, _) = now.entry(entry);
                if to < from {
                    refused = true;
                    operations.push(loosened(entry, from, to));
                }
            }
            Target::GroupAction { group, action } => {
                // Removing the policy's own exception leaves what the pair
                // falls back to: the default for a policy that owns its
                // settings, its source's pair for a follower.
                let to = change
                    .state
                    .unwrap_or_else(|| now.pair_without_own_exception(group, *action).0);
                let (from, _) = now.pair(group, *action);
                if to < from {
                    refused = true;
                    operations.extend(
                        catalog
                            .entries
                            .iter()
                            .filter(|entry| entry.group == *group && entry.action == *action)
                            .map(|entry| loosened(entry, from, to)),
                    );
                }
            }
            Target::Action { action } => {
                let to = change.state.unwrap_or(PermissionState::Always);
                let (from, _) = now.default(*action);
                if to < from {
                    refused = true;
                    // The operations that follow the default: in a group
                    // with no exception for the action.
                    operations.extend(
                        catalog
                            .entries
                            .iter()
                            .filter(|entry| {
                                entry.action == *action && !now.has_exception(&entry.group, *action)
                            })
                            .map(|entry| loosened(entry, from, to)),
                    );
                }
            }
        }
    }
    if refused { Err(operations) } else { Ok(()) }
}

/// Refuses a person's change to a following policy that asks for a state
/// looser than its source gives the target on its own (without the policy's
/// own rows): every row of a follower only restricts, so such a row would be
/// saved and do nothing. Raising it takes an edit of the source, or a
/// detach and then an edit. A removal is never refused. Names the
/// operations that resolve through the target.
pub fn below_source(
    catalog: &Catalog,
    chain: &PolicyChain,
    changes: &[Change],
) -> Result<(), Vec<LoosenedOperation>> {
    if !chain.follows() {
        return Ok(());
    }
    let source = Resolver::with_rules(chain, &[], &[]);
    let mut refused = false;
    let mut operations: Vec<LoosenedOperation> = Vec::new();
    for change in changes {
        let Some(to) = change.state else {
            continue;
        };
        let (floor, entries): (PermissionState, Vec<&CatalogEntry>) = match &change.target {
            Target::Tool { service, operation } => {
                let Some(entry) = catalog.entry(service, operation) else {
                    continue;
                };
                (source.entry(entry).0, vec![entry])
            }
            Target::GroupAction { group, action } => (
                source.pair(group, *action).0,
                catalog
                    .entries
                    .iter()
                    .filter(|entry| entry.group == *group && entry.action == *action)
                    .collect(),
            ),
            Target::Action { action } => (
                source.default(*action).0,
                catalog
                    .entries
                    .iter()
                    .filter(|entry| {
                        entry.action == *action && !source.has_exception(&entry.group, *action)
                    })
                    .collect(),
            ),
        };
        if to < floor {
            refused = true;
            operations.extend(entries.into_iter().map(|entry| loosened(entry, floor, to)));
        }
    }
    if refused { Err(operations) } else { Ok(()) }
}
