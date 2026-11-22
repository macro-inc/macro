//! Resolution: what state each operation has under a policy's saved settings
//! and a session's overlay, the view built from it, and the tighten-only rule.
//!
//! An operation's state is its own setting if a person made it, else its
//! group's action setting, else always. An operation setting not made by a
//! signed-in person (the agent restricting itself, an API key) only adds to
//! its group's action: it takes the stricter of the two, so a person's later, stricter group setting still
//! applies to it. The session overlay is the agent's too and can only add
//! restrictions: the effective state is the stricter of the saved state and
//! the overlay's. Nothing is inferred: a new operation takes its group's
//! action setting and a new group has no settings, so it is always.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use agent_permission_registry::Action;
use bot_id::BotId;
use chrono::Utc;

use super::model::{
    Catalog, CatalogEntry, Change, LoosenedOperation, Origin, PermissionState, PermissionsView,
    PolicyId, PolicyKind, Rule, SetBy, Target, ToolPermissionAction, ToolPermissionCatalog,
    ToolPermissionCatalogAction, ToolPermissionCatalogGroup, ToolPermissionGroup,
    ToolPermissionOverride,
};

/// One layer of settings (saved, or a session's overlay), indexed for lookup.
#[derive(Debug, Default)]
pub struct Layer<'a> {
    group_actions: HashMap<(&'a str, Action), PermissionState>,
    tools: HashMap<(&'a str, &'a str), ToolSetting>,
}

/// An operation's own setting, and whether it only restricts.
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
            match &rule.target {
                Target::GroupAction { group, action } => {
                    layer
                        .group_actions
                        .insert((group.as_str(), *action), rule.state);
                }
                Target::Tool { service, operation } => {
                    layer.tools.insert(
                        (service.as_str(), operation.as_str()),
                        ToolSetting {
                            state: rule.state,
                            restriction_only: rule.restriction_only,
                        },
                    );
                }
            }
        }
        layer
    }

    fn group_action(&self, group: &str, action: Action) -> Option<PermissionState> {
        self.group_actions.get(&(group, action)).copied()
    }

    fn tool(&self, entry: &CatalogEntry) -> Option<ToolSetting> {
        self.tools
            .get(&(entry.service.as_str(), entry.operation.as_str()))
            .copied()
    }
}

/// The state of `group`'s `action` under `saved` and `overlay`, ignoring
/// operations' own settings, and where it comes from.
fn action_state(
    saved: &Layer,
    overlay: &Layer,
    group: &str,
    action: Action,
) -> (PermissionState, Origin) {
    let (base, origin) = match saved.group_action(group, action) {
        Some(state) => (state, Origin::GroupAction),
        None => (PermissionState::Always, Origin::Default),
    };
    let extra = overlay
        .group_action(group, action)
        .unwrap_or(PermissionState::Always);
    if extra > base {
        (extra, Origin::Session)
    } else {
        (base, origin)
    }
}

/// The effective state of `entry` under `saved` and `overlay`, and where it
/// comes from.
pub fn effective(
    saved: &Layer,
    overlay: &Layer,
    entry: &CatalogEntry,
) -> (PermissionState, Origin) {
    let group = match saved.group_action(&entry.group, entry.action) {
        Some(state) => (state, Origin::GroupAction),
        None => (PermissionState::Always, Origin::Default),
    };
    let (base, origin) = match saved.tool(entry) {
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
        }) if state > group.0 => (state, Origin::Tool),
        Some(_) | None => group,
    };
    // The overlay is all the agent's, so it too is the stricter of the
    // operation's and its group's.
    let extra = overlay
        .tool(entry)
        .map(|setting| setting.state)
        .into_iter()
        .chain(overlay.group_action(&entry.group, entry.action))
        .max()
        .unwrap_or(PermissionState::Always);
    if extra > base {
        (extra, Origin::Session)
    } else {
        (base, origin)
    }
}

/// Who may do what with a view, decided by the service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewAccess {
    /// May set and reset.
    pub can_edit: bool,
    /// May tighten.
    pub can_tighten: bool,
}

/// Every catalog group with the actions it has operations for, resolved
/// under `saved` and `overlay` (`None` for no session). A pair no operation
/// maps to, and a group with none, is left out: no setting there can change
/// what the agent does. Its saved rule stays in `rules` and applies as soon
/// as an operation maps there, since resolution never looks at the view.
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

    let mut restricted: u32 = 0;
    let mut groups = Vec::with_capacity(catalog.groups.len());
    for group in &catalog.groups {
        let mut actions = Vec::with_capacity(Action::ALL.len());
        for action in Action::ALL {
            let entries: Vec<&CatalogEntry> = catalog
                .entries
                .iter()
                .filter(|entry| entry.group == group.id && entry.action == action)
                .collect();
            if entries.is_empty() {
                continue;
            }
            let (state, origin) = action_state(&saved_layer, &overlay_layer, &group.id, action);
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
        rules: saved,
        session_rules: overlay,
        groups,
    }
}

/// The catalog as the API lists it.
pub fn catalog_view(catalog: &Catalog) -> ToolPermissionCatalog {
    ToolPermissionCatalog {
        version: catalog.version.clone(),
        actions: Action::ALL
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
        Action::Update => ("Update", "Changes something that exists."),
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
            Target::GroupAction { group, .. } => catalog.group(group).is_none(),
            Target::Tool { service, operation } => catalog.entry(service, operation).is_none(),
        })
        .cloned()
        .collect()
}

/// Whether a write keeps `state` for `target`. A group's action is never
/// stored as always (its default); a restriction (a tightening, or an
/// overlay) never stores always at all: on a tool it would exempt it from a
/// stricter group setting.
fn stores(target: &Target, state: PermissionState, restriction: bool) -> bool {
    match target {
        Target::GroupAction { .. } => state != PermissionState::Always,
        Target::Tool { .. } => !restriction || state != PermissionState::Always,
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

/// Refuses a change that makes any operation more permissive: compares every
/// operation's effective state before and after, under the saved settings and
/// the overlay as they will stand. One pointwise rule, so no combination of
/// group and operation settings can loosen anything.
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
            (to < from).then(|| LoosenedOperation {
                service: entry.service.clone(),
                operation: entry.operation.clone(),
                label: entry.label.clone(),
                from,
                to,
            })
        })
        .collect();
    if loosened.is_empty() {
        Ok(())
    } else {
        Err(loosened)
    }
}

/// Refuses a change that asks for a state looser than its target has now:
/// an operation's own state looser than its effective state, or a group's
/// action looser than its setting (removing it asks for always). The agent's
/// setting on an operation only adds to its group's, so the first would be
/// saved as a no-op; the second would drop a person's setting even where no
/// operation's state moves today (each operation has its own setting, or the
/// group has no operations for that action yet), and every operation
/// resolving through it later would be looser. Both are refused.
pub fn asks_looser(
    catalog: &Catalog,
    (saved, overlay): (&[Rule], &[Rule]),
    changes: &[Change],
) -> Result<(), Vec<LoosenedOperation>> {
    let (saved, overlay) = (Layer::new(saved), Layer::new(overlay));
    let loosened = |entry: &CatalogEntry, from, to| LoosenedOperation {
        service: entry.service.clone(),
        operation: entry.operation.clone(),
        label: entry.label.clone(),
        from,
        to,
    };
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
                let to = change.state.unwrap_or(PermissionState::Always);
                let (from, _) = action_state(&saved, &overlay, group, *action);
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
        }
    }
    if refused { Err(operations) } else { Ok(()) }
}
