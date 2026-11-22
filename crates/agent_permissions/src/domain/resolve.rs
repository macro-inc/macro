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

#[cfg(test)]
mod test;

use std::collections::HashMap;

use agent_permission_registry::Action;
use bot_id::BotId;
use chrono::Utc;

use super::model::{
    Catalog, CatalogEntry, Change, LoosenedOperation, Origin, PermissionState, PermissionsView,
    PolicyId, PolicyKind, Rule, SetBy, Target, ToolPermissionAction, ToolPermissionCatalog,
    ToolPermissionCatalogAction, ToolPermissionCatalogGroup, ToolPermissionDefault,
    ToolPermissionGroup, ToolPermissionOverride,
};

/// One layer of settings (saved, or a session's overlay), indexed for lookup.
#[derive(Debug, Default)]
pub struct Layer<'a> {
    actions: HashMap<Action, PermissionState>,
    group_actions: HashMap<(&'a str, Action), ToolSetting>,
    tools: HashMap<(&'a str, &'a str), ToolSetting>,
}

/// A group's action or an operation's own setting, and whether it only
/// restricts.
#[derive(Debug, Clone, Copy)]
struct ToolSetting {
    state: PermissionState,
    restriction_only: bool,
}

impl<'a> Layer<'a> {
    /// Index `rules`.
    pub fn new(rules: &'a [Rule]) -> Self {
        let mut layer = Layer::default();
        for rule in rules {
            let setting = ToolSetting {
                state: rule.state,
                restriction_only: rule.restriction_only,
            };
            match &rule.target {
                Target::Action { action } => {
                    layer.actions.insert(*action, rule.state);
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
        self.actions.get(&action).copied()
    }

    fn group_action(&self, group: &str, action: Action) -> Option<ToolSetting> {
        self.group_actions.get(&(group, action)).copied()
    }

    /// Whether the layer holds an exception for `group`'s `action`.
    fn has_exception(&self, group: &str, action: Action) -> bool {
        self.group_actions.contains_key(&(group, action))
    }

    fn tool(&self, entry: &CatalogEntry) -> Option<ToolSetting> {
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

/// `action`'s default under `saved` alone.
fn saved_default(saved: &Layer, action: Action) -> (PermissionState, Origin) {
    match saved.action(action) {
        Some(state) => (state, Origin::Action),
        None => (PermissionState::Always, Origin::Default),
    }
}

/// `group`'s `action` under `saved` alone: a person's exception replaces the
/// default; anyone else's only adds to it.
fn saved_pair(saved: &Layer, group: &str, action: Action) -> (PermissionState, Origin) {
    let default = saved_default(saved, action);
    match saved.group_action(group, action) {
        Some(ToolSetting {
            state,
            restriction_only: false,
        }) => (state, Origin::GroupAction),
        Some(ToolSetting {
            state,
            restriction_only: true,
        }) if state > default.0 => (state, Origin::GroupAction),
        Some(_) | None => default,
    }
}

/// The state of `action`'s default under `saved` and `overlay`, and where it
/// comes from.
pub fn default_state(saved: &Layer, overlay: &Layer, action: Action) -> (PermissionState, Origin) {
    with_overlay(saved_default(saved, action), overlay.action(action))
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
        saved_pair(saved, group, action),
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
    let pair = saved_pair(saved, &entry.group, entry.action);
    let base = match saved.tool(entry) {
        // A person's setting on the operation replaces its group's.
        Some(ToolSetting {
            state,
            restriction_only: false,
        }) => (state, Origin::Tool),
        // Anyone else's (the agent's, an API key's) only adds to it: a
        // stricter group setting still wins.
        Some(ToolSetting {
            state,
            restriction_only: true,
        }) if state > pair.0 => (state, Origin::Tool),
        Some(_) | None => pair,
    };
    // The overlay is all the agent's, so it too is the stricter of the
    // operation's, its group's and the action's.
    let extra = overlay
        .tool(entry)
        .map(|setting| setting.state)
        .into_iter()
        .chain(overlay.restriction(&entry.group, entry.action))
        .max();
    with_overlay(base, extra)
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
/// operations for, resolved under `saved` and `overlay` (`None` for no
/// session), in display order. A pair no operation maps to, and a group with
/// none, is left out: no setting there can change what the agent does. Its
/// saved rule stays in `rules` and applies as soon as an operation maps
/// there, since resolution never looks at the view.
pub fn view(
    catalog: &Catalog,
    agent_id: BotId,
    policy_id: PolicyId,
    kind: PolicyKind,
    access: ViewAccess,
    saved: Vec<Rule>,
    overlay: Option<Vec<Rule>>,
) -> PermissionsView {
    let saved_layer = Layer::new(&saved);
    let overlay_layer = overlay.as_deref().map(Layer::new).unwrap_or_default();

    let defaults = Action::DISPLAY
        .into_iter()
        .map(|action| {
            let (state, origin) = default_state(&saved_layer, &overlay_layer, action);
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
            let (state, origin) = pair_state(&saved_layer, &overlay_layer, &group.id, action);
            let mut overrides = Vec::new();

            // An operation differs from its action only through its own
            // setting, saved or in the overlay.
            for entry in entries.iter().copied() {
                let (tool_state, tool_origin) = effective(&saved_layer, &overlay_layer, entry);
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
                exception: saved_layer.has_exception(&group.id, action),
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
        policy_id,
        kind,
        can_edit: access.can_edit,
        can_tighten: access.can_tighten,
        version: catalog.version.clone(),
        restricted,
        defaults,
        rules: saved,
        session_rules: overlay,
        groups,
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

/// Refuses a change that makes anything more permissive: compares, before
/// and after, under the saved settings and the overlay as they will stand,
/// every operation's effective state, every catalog group's every action
/// (including pairs no operation maps to yet) and every action's default.
/// One pointwise rule, so no combination of settings can loosen anything,
/// today or once the registry maps a new operation. Only operations are
/// named; a change that loosens only a pair or a default is refused with
/// none.
pub fn tighten_only(
    catalog: &Catalog,
    (saved_before, overlay_before): (&[Rule], &[Rule]),
    (saved_after, overlay_after): (&[Rule], &[Rule]),
) -> Result<(), Vec<LoosenedOperation>> {
    let before = (Layer::new(saved_before), Layer::new(overlay_before));
    let after = (Layer::new(saved_after), Layer::new(overlay_after));
    let loosened: Vec<LoosenedOperation> = catalog
        .entries
        .iter()
        .filter_map(|entry| {
            let (from, _) = effective(&before.0, &before.1, entry);
            let (to, _) = effective(&after.0, &after.1, entry);
            (to < from).then(|| loosened(entry, from, to))
        })
        .collect();
    let loosens_a_default = Action::ALL.into_iter().any(|action| {
        default_state(&after.0, &after.1, action).0 < default_state(&before.0, &before.1, action).0
    });
    let loosens_a_pair = catalog.groups.iter().any(|group| {
        Action::ALL.into_iter().any(|action| {
            pair_state(&after.0, &after.1, &group.id, action).0
                < pair_state(&before.0, &before.1, &group.id, action).0
        })
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
    (saved, overlay): (&[Rule], &[Rule]),
    changes: &[Change],
) -> Result<(), Vec<LoosenedOperation>> {
    let (saved, overlay) = (Layer::new(saved), Layer::new(overlay));
    let mut refused = false;
    let mut operations: Vec<LoosenedOperation> = Vec::new();
    for change in changes {
        match &change.target {
            Target::Tool { service, operation } => {
                let (Some(to), Some(entry)) = (change.state, catalog.entry(service, operation))
                else {
                    continue;
                };
                let (from, _) = effective(&saved, &overlay, entry);
                if to < from {
                    refused = true;
                    operations.push(loosened(entry, from, to));
                }
            }
            Target::GroupAction { group, action } => {
                let to = change
                    .state
                    .unwrap_or_else(|| default_state(&saved, &overlay, *action).0);
                let (from, _) = pair_state(&saved, &overlay, group, *action);
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
                let (from, _) = default_state(&saved, &overlay, *action);
                if to < from {
                    refused = true;
                    // The operations that follow the default: in a group
                    // with no exception for the action.
                    operations.extend(
                        catalog
                            .entries
                            .iter()
                            .filter(|entry| {
                                entry.action == *action
                                    && !saved.has_exception(&entry.group, *action)
                            })
                            .map(|entry| loosened(entry, from, to)),
                    );
                }
            }
        }
    }
    if refused { Err(operations) } else { Ok(()) }
}
