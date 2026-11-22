use super::*;
use crate::domain::model::{CatalogGroup, PermissionState::*};
use chrono::DateTime;

fn group(id: &str) -> CatalogGroup {
    CatalogGroup {
        id: id.to_owned(),
        name: id.to_owned(),
        description: id.to_owned(),
    }
}

fn entry(service: &str, operation: &str, group: &str, action: Action) -> CatalogEntry {
    CatalogEntry {
        service: service.to_owned(),
        operation: operation.to_owned(),
        group: group.to_owned(),
        action,
        label: operation.to_owned(),
    }
}

fn catalog() -> Catalog {
    Catalog {
        version: "0123456789ab".to_owned(),
        groups: vec![group("documents"), group("email"), group("calendar")],
        entries: vec![
            entry("storage", "create_document", "documents", Action::Create),
            entry("storage", "delete_document", "documents", Action::Destroy),
            entry("storage", "delete_project", "documents", Action::Destroy),
            entry("email", "send_email", "email", Action::Send),
            entry("email", "list_threads", "email", Action::Read),
            entry("calendar", "create_event", "calendar", Action::Create),
        ],
        always_allowed: Vec::new(),
    }
}

fn group_rule(group: &str, action: Action, state: PermissionState) -> Rule {
    Rule {
        target: Target::GroupAction {
            group: group.to_owned(),
            action,
        },
        state,
        via_agent: false,
        restriction_only: false,
        updated_at: DateTime::UNIX_EPOCH,
    }
}

fn tool_rule(service: &str, operation: &str, state: PermissionState) -> Rule {
    Rule {
        target: Target::Tool {
            service: service.to_owned(),
            operation: operation.to_owned(),
        },
        state,
        via_agent: false,
        restriction_only: false,
        updated_at: DateTime::UNIX_EPOCH,
    }
}

fn agent_tool_rule(service: &str, operation: &str, state: PermissionState) -> Rule {
    Rule {
        via_agent: true,
        restriction_only: true,
        ..tool_rule(service, operation, state)
    }
}

fn state_of(
    saved: &[Rule],
    overlay: &[Rule],
    service: &str,
    operation: &str,
) -> (PermissionState, Origin) {
    let catalog = catalog();
    let entry = catalog.entry(service, operation).unwrap();
    effective(&Layer::new(saved), &Layer::new(overlay), entry)
}

#[test]
fn an_operation_takes_its_own_setting_then_its_group_action_then_always() {
    let saved = [
        group_rule("documents", Action::Destroy, Never),
        tool_rule("storage", "delete_project", Ask),
    ];

    assert_eq!(
        state_of(&saved, &[], "storage", "delete_project"),
        (Ask, Origin::Tool)
    );
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_document"),
        (Never, Origin::GroupAction)
    );
    assert_eq!(
        state_of(&saved, &[], "storage", "create_document"),
        (Always, Origin::Default)
    );
}

#[test]
fn the_session_overlay_only_ever_makes_an_operation_stricter() {
    let saved = [group_rule("email", Action::Send, Ask)];
    let overlay = [
        group_rule("email", Action::Send, Never),
        tool_rule("email", "list_threads", Ask),
    ];

    assert_eq!(
        state_of(&saved, &overlay, "email", "send_email"),
        (Never, Origin::Session)
    );
    assert_eq!(
        state_of(&saved, &overlay, "email", "list_threads"),
        (Ask, Origin::Session)
    );

    // A laxer overlay leaves the saved state.
    let saved = [tool_rule("email", "send_email", Never)];
    let overlay = [tool_rule("email", "send_email", Ask)];
    assert_eq!(
        state_of(&saved, &overlay, "email", "send_email"),
        (Never, Origin::Tool)
    );
}

#[test]
fn an_agents_tool_setting_never_exempts_it_from_a_stricter_group_setting() {
    // The agent pins `send_email` to ask while Email·Send is always.
    let mut saved = vec![
        group_rule("email", Action::Send, Always),
        agent_tool_rule("email", "send_email", Ask),
    ];
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Ask, Origin::Tool)
    );

    // The person then sets Email·Send to never: the tool follows.
    saved[0] = group_rule("email", Action::Send, Never);
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Never, Origin::GroupAction)
    );

    // An agent's tool setting equal to its group's adds nothing.
    saved[0] = group_rule("email", Action::Send, Ask);
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Ask, Origin::GroupAction)
    );

    // A person's tool setting still replaces its group's.
    saved[0] = group_rule("email", Action::Send, Never);
    saved[1] = tool_rule("email", "send_email", Ask);
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Ask, Origin::Tool)
    );
}

#[test]
fn an_overlay_tool_setting_never_exempts_it_from_the_overlays_group_setting() {
    let overlay = [
        tool_rule("email", "send_email", Ask),
        group_rule("email", Action::Send, Never),
    ];
    assert_eq!(
        state_of(&[], &overlay, "email", "send_email"),
        (Never, Origin::Session)
    );
}

#[test]
fn asking_for_a_tool_state_looser_than_it_has_is_refused() {
    let catalog = catalog();
    let saved = [group_rule("email", Action::Send, Never)];
    let ask = [change(tool("email", "send_email"), Some(Ask))];
    let loosened = asks_looser(&catalog, (&saved, &[]), &ask).unwrap_err();
    assert_eq!(loosened[0].from, Never);
    assert_eq!(loosened[0].to, Ask);

    // Moving the group's never onto the tool asks for nothing looser.
    let never = [change(tool("email", "send_email"), Some(Never))];
    assert_eq!(asks_looser(&catalog, (&saved, &[]), &never), Ok(()));
    // Nor does pinning ask under an always group.
    assert_eq!(asks_looser(&catalog, (&[], &[]), &ask), Ok(()));
}

#[test]
fn removing_or_loosening_a_group_setting_is_refused_even_when_no_operation_moves() {
    let catalog = catalog();
    // Every documents·destroy operation has a person's own setting, so
    // dropping the group's never moves nothing today.
    let saved = [
        group_rule("documents", Action::Destroy, Never),
        tool_rule("storage", "delete_document", Never),
        tool_rule("storage", "delete_project", Never),
    ];
    for state in [None, Some(Always), Some(Ask)] {
        let drop = [change(group_action("documents", Action::Destroy), state)];
        assert!(asks_looser(&catalog, (&saved, &[]), &drop).is_err());
    }

    // A group and action with no operations yet.
    let saved = [group_rule("calendar", Action::Send, Never)];
    let drop = [change(group_action("calendar", Action::Send), None)];
    assert_eq!(asks_looser(&catalog, (&saved, &[]), &drop), Err(Vec::new()));

    // Tightening a group passes.
    let never = [change(group_action("calendar", Action::Send), Some(Never))];
    assert_eq!(asks_looser(&catalog, (&saved, &[]), &never), Ok(()));
}

#[test]
fn a_new_operation_takes_its_groups_action_and_a_new_group_is_always() {
    // Rules saved before `delete_project` or `calendar` existed.
    let saved = [
        group_rule("documents", Action::Destroy, Never),
        tool_rule("storage", "delete_document", Ask),
    ];

    assert_eq!(
        state_of(&saved, &[], "storage", "delete_project"),
        (Never, Origin::GroupAction)
    );
    assert_eq!(
        state_of(&saved, &[], "calendar", "create_event"),
        (Always, Origin::Default)
    );
}

fn tighten(saved: &[Rule], changes: Vec<Change>) -> Result<(), Vec<LoosenedOperation>> {
    let changes = normalize(changes, false);
    let after = apply(saved, &changes, SetBy::Person);
    tighten_only(&catalog(), (saved, &[]), (&after, &[]))
}

fn change(target: Target, state: Option<PermissionState>) -> Change {
    Change { target, state }
}

fn tool(service: &str, operation: &str) -> Target {
    Target::Tool {
        service: service.to_owned(),
        operation: operation.to_owned(),
    }
}

fn group_action(group: &str, action: Action) -> Target {
    Target::GroupAction {
        group: group.to_owned(),
        action,
    }
}

#[test]
fn tightening_passes_and_every_way_of_loosening_is_refused() {
    assert_eq!(
        tighten(
            &[],
            vec![change(group_action("email", Action::Send), Some(Never))]
        ),
        Ok(())
    );

    // Removing a tool's `never` under an always group.
    let loosened = tighten(
        &[tool_rule("storage", "delete_document", Never)],
        vec![change(tool("storage", "delete_document"), None)],
    )
    .unwrap_err();
    assert_eq!(
        loosened,
        vec![LoosenedOperation {
            service: "storage".to_owned(),
            operation: "delete_document".to_owned(),
            label: "delete_document".to_owned(),
            from: Never,
            to: Always,
        }]
    );

    // `never` down to `ask`.
    assert!(
        tighten(
            &[group_rule("email", Action::Send, Never)],
            vec![change(group_action("email", Action::Send), Some(Ask))],
        )
        .is_err()
    );

    // A tool `always` under a `never` group.
    assert!(
        tighten(
            &[group_rule("documents", Action::Destroy, Never)],
            vec![change(tool("storage", "delete_project"), Some(Always))],
        )
        .is_err()
    );

    // Clearing a group action by setting it to always.
    assert!(
        tighten(
            &[group_rule("documents", Action::Destroy, Ask)],
            vec![change(
                group_action("documents", Action::Destroy),
                Some(Always)
            )],
        )
        .is_err()
    );
}

#[test]
fn an_agents_tool_pin_is_tightening_and_survives_as_the_stricter_setting() {
    // Under an always group, the agent pins a tool to ask: a tightening.
    let catalog = catalog();
    let saved = [group_rule("email", Action::Send, Always)];
    let pin = normalize(vec![change(tool("email", "send_email"), Some(Ask))], true);
    let after = apply(&saved, &pin, SetBy::Agent);
    assert_eq!(tighten_only(&catalog, (&saved, &[]), (&after, &[])), Ok(()));
    assert!(after.iter().any(|rule| rule.via_agent));
}

#[test]
fn moving_a_groups_never_onto_each_of_its_tools_loosens_no_operation_but_is_refused() {
    let saved = [group_rule("documents", Action::Destroy, Never)];
    let changes = vec![
        change(tool("storage", "delete_document"), Some(Never)),
        change(tool("storage", "delete_project"), Some(Never)),
        change(group_action("documents", Action::Destroy), None),
    ];
    // No operation loosens, but an operation added to documents·destroy
    // later would be always: both checks refuse, naming none.
    assert_eq!(tighten(&saved, changes.clone()), Err(Vec::new()));
    assert!(asks_looser(&catalog(), (&saved, &[]), &changes).is_err());
}

#[test]
fn a_session_overlay_can_tighten_but_never_loosen() {
    let catalog = catalog();
    let overlay = [tool_rule("email", "send_email", Never)];

    let removal = normalize(vec![change(tool("email", "send_email"), None)], true);
    let after = apply(&overlay, &removal, SetBy::Agent);
    assert!(tighten_only(&catalog, (&[], &overlay), (&[], &after)).is_err());

    // An overlay holds no `always`: it becomes a removal.
    let to_always = normalize(
        vec![change(tool("email", "send_email"), Some(Always))],
        true,
    );
    assert_eq!(to_always, removal);
}

fn view_of(catalog: &Catalog, saved: Vec<Rule>, overlay: Option<Vec<Rule>>) -> PermissionsView {
    view_with_policy(catalog, PolicyId::generate(), saved, overlay)
}

/// [`view_of`] under the policy id `policy`.
fn view_with_policy(
    catalog: &Catalog,
    policy: PolicyId,
    saved: Vec<Rule>,
    overlay: Option<Vec<Rule>>,
) -> PermissionsView {
    view(
        catalog,
        BotId::TEST_A,
        policy,
        PolicyKind::Agent,
        ViewAccess {
            can_edit: true,
            can_tighten: true,
        },
        saved,
        overlay,
    )
}

/// `group`'s `action` in `view`, if the view lists it.
fn pair<'a>(
    view: &'a PermissionsView,
    group: &str,
    action: Action,
) -> Option<&'a ToolPermissionAction> {
    view.groups
        .iter()
        .find(|resolved| resolved.group == group)?
        .actions
        .iter()
        .find(|resolved| resolved.action == action)
}

#[test]
fn the_view_lists_overrides_and_counts_restricted_operations() {
    let saved = vec![
        group_rule("documents", Action::Destroy, Never),
        tool_rule("storage", "delete_project", Ask),
        // Same as its action: listed in rules, not an override.
        tool_rule("email", "list_threads", Always),
    ];
    let overlay = vec![tool_rule("email", "send_email", Never)];

    let policy = PolicyId::generate();
    let view = view_with_policy(&catalog(), policy, saved.clone(), Some(overlay.clone()));

    assert_eq!(view.policy_id, policy);
    assert_eq!(view.restricted, 3);
    assert_eq!(view.rules, saved);
    assert_eq!(view.session_rules, Some(overlay));
    assert_eq!(view.version, "0123456789ab");

    assert_eq!(view.groups[0].group, "documents");
    let destroy = pair(&view, "documents", Action::Destroy).unwrap();
    assert_eq!(
        (destroy.action, destroy.state, destroy.origin, destroy.tools),
        (Action::Destroy, Never, Origin::GroupAction, 2)
    );
    assert_eq!(
        destroy.overrides,
        vec![ToolPermissionOverride {
            service: "storage".to_owned(),
            operation: "delete_project".to_owned(),
            label: "delete_project".to_owned(),
            state: Ask,
            origin: Origin::Tool,
        }]
    );

    let send = pair(&view, "email", Action::Send).unwrap();
    assert_eq!((send.state, send.origin), (Always, Origin::Default));
    assert_eq!(send.overrides.len(), 1);
    assert_eq!(send.overrides[0].origin, Origin::Session);
    assert!(
        pair(&view, "email", Action::Read)
            .unwrap()
            .overrides
            .is_empty()
    );
}

#[test]
fn the_view_hides_pairs_with_no_tool_but_keeps_their_rules() {
    let mut catalog = catalog();
    // A group with no operations at all.
    catalog.groups.push(group("tasks"));
    let saved = vec![
        // On pairs no operation maps to: documents has no send, tasks nothing.
        group_rule("documents", Action::Send, Never),
        group_rule("tasks", Action::Send, Ask),
        group_rule("documents", Action::Destroy, Ask),
    ];

    let view = view_of(&catalog, saved.clone(), Some(Vec::new()));

    // Each group lists only the actions it has operations for, in order.
    let listed: Vec<(&str, Vec<Action>)> = view
        .groups
        .iter()
        .map(|group| {
            (
                group.group.as_str(),
                group.actions.iter().map(|action| action.action).collect(),
            )
        })
        .collect();
    assert_eq!(
        listed,
        vec![
            ("documents", vec![Action::Create, Action::Destroy]),
            ("email", vec![Action::Read, Action::Send]),
            ("calendar", vec![Action::Create]),
        ]
    );
    assert!(
        view.groups
            .iter()
            .all(|group| { group.actions.iter().all(|action| action.tools > 0) })
    );
    // The hidden rules stay saved and listed.
    assert_eq!(view.rules, saved);
    // Only operations count as restricted: the two documents deletions.
    assert_eq!(view.restricted, 2);
}

#[test]
fn a_rule_on_a_pair_with_no_tool_applies_once_a_tool_maps_there() {
    let saved = vec![group_rule("documents", Action::Send, Ask)];
    assert!(
        pair(
            &view_of(&catalog(), saved.clone(), None),
            "documents",
            Action::Send
        )
        .is_none()
    );

    // A later registry maps an operation to Documents · Send.
    let mut catalog = catalog();
    catalog.entries.push(entry(
        "storage",
        "share_document",
        "documents",
        Action::Send,
    ));
    let send = pair(
        &view_of(&catalog, saved.clone(), None),
        "documents",
        Action::Send,
    )
    .cloned()
    .unwrap();
    assert_eq!(
        (send.state, send.origin, send.tools),
        (Ask, Origin::GroupAction, 1)
    );
    let entry = catalog.entry("storage", "share_document").unwrap();
    assert_eq!(
        effective(&Layer::new(&saved), &Layer::default(), entry),
        (Ask, Origin::GroupAction)
    );
}

#[test]
fn the_catalog_lists_actions_in_display_order_as_edit_and_delete_and_tools_by_group() {
    let catalog = catalog_view(&catalog());
    let names: Vec<&str> = catalog.actions.iter().map(|action| action.name).collect();
    assert_eq!(names, ["Read", "Create", "Edit", "Send", "Delete"]);
    let actions: Vec<Action> = catalog.actions.iter().map(|action| action.action).collect();
    assert_eq!(actions, Action::DISPLAY);
    assert_eq!(catalog.groups[0].tools.len(), 3);

    let json = serde_json::to_value(&catalog.groups[0].tools[0]).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "service": "storage",
            "operation": "create_document",
            "action": "create",
            "label": "create_document",
        })
    );
}

#[test]
fn unknown_groups_and_tools_are_named() {
    let unknown = unknown_targets(
        &catalog(),
        &[
            change(group_action("documents", Action::Send), Some(Never)),
            change(group_action("payroll", Action::Read), Some(Never)),
            change(tool("storage", "launch_rocket"), Some(Never)),
        ],
    );
    assert_eq!(
        unknown,
        vec![
            group_action("payroll", Action::Read),
            tool("storage", "launch_rocket")
        ]
    );
}

/// The registry's `channel_admin` operations, each as it was classified
/// before the move (in `channels`, same action) and as it is now.
fn channel_admin_moves() -> Vec<(CatalogEntry, CatalogEntry)> {
    let moved: Vec<(CatalogEntry, CatalogEntry)> = agent_permission_registry::operations()
        .filter(|(_, _, operation)| operation.group == "channel_admin")
        .map(|(service, operation, classification)| {
            (
                entry(service, operation, "channels", classification.action),
                entry(service, operation, "channel_admin", classification.action),
            )
        })
        .collect();
    assert!(
        !moved.is_empty(),
        "the registry has channel_admin operations"
    );
    moved
}

/// What the channel administration migration does to a policy: each
/// `channels:<action>` rule gains a `channel_admin:<action>` copy.
fn with_channel_admin_copies(saved: &[Rule]) -> Vec<Rule> {
    let mut copied = saved.to_vec();
    for rule in saved {
        if let Target::GroupAction { group, action } = &rule.target
            && group == "channels"
        {
            copied.push(Rule {
                target: Target::GroupAction {
                    group: "channel_admin".to_owned(),
                    action: *action,
                },
                ..rule.clone()
            });
        }
    }
    copied
}

#[test]
fn channel_admin_moves_keep_every_operations_state() {
    let moves = channel_admin_moves();

    let send_never = [group_rule("channels", Action::Send, Never)];
    let copied = with_channel_admin_copies(&send_never);
    for (_, now) in moves.iter().filter(|(_, now)| now.action == Action::Send) {
        assert_eq!(
            effective(&Layer::new(&copied), &Layer::new(&[]), now),
            (Never, Origin::GroupAction),
            "{}.{}",
            now.service,
            now.operation
        );
    }

    let saved = [
        group_rule("channels", Action::Send, Never),
        group_rule("channels", Action::Read, Ask),
        group_rule("channels", Action::Update, Ask),
        group_rule("channels", Action::Destroy, Never),
        tool_rule("storage", "join_channel", Ask),
        agent_tool_rule("storage", "list_channel_bots", Never),
    ];
    let overlay = [group_rule("channels", Action::Update, Never)];
    let (copied, copied_overlay) = (
        with_channel_admin_copies(&saved),
        with_channel_admin_copies(&overlay),
    );
    for (before, now) in &moves {
        assert_eq!(
            effective(&Layer::new(&copied), &Layer::new(&copied_overlay), now),
            effective(&Layer::new(&saved), &Layer::new(&overlay), before),
            "{}.{}",
            now.service,
            now.operation
        );
    }
}

fn default_rule(action: Action, state: PermissionState) -> Rule {
    Rule {
        target: Target::Action { action },
        state,
        via_agent: false,
        restriction_only: false,
        updated_at: DateTime::UNIX_EPOCH,
    }
}

fn agent_group_rule(group: &str, action: Action, state: PermissionState) -> Rule {
    Rule {
        via_agent: true,
        restriction_only: true,
        ..group_rule(group, action, state)
    }
}

fn default_target(action: Action) -> Target {
    Target::Action { action }
}

/// Each default in `view`, in order.
fn defaults_of(view: &PermissionsView) -> Vec<(Action, PermissionState, Origin)> {
    view.defaults
        .iter()
        .map(|default| (default.action, default.state, default.origin))
        .collect()
}

#[test]
fn an_action_default_applies_to_every_entity_without_an_exception() {
    let saved = [default_rule(Action::Destroy, Ask)];
    for operation in ["delete_document", "delete_project"] {
        assert_eq!(
            state_of(&saved, &[], "storage", operation),
            (Ask, Origin::Action)
        );
    }
    // Other actions keep their own default: none, so always.
    assert_eq!(
        state_of(&saved, &[], "storage", "create_document"),
        (Always, Origin::Default)
    );

    let view = view_of(&catalog(), saved.to_vec(), None);
    assert_eq!(
        defaults_of(&view),
        vec![
            (Action::Read, Always, Origin::Default),
            (Action::Create, Always, Origin::Default),
            (Action::Update, Always, Origin::Default),
            (Action::Send, Always, Origin::Default),
            (Action::Destroy, Ask, Origin::Action),
        ]
    );
    let destroy = pair(&view, "documents", Action::Destroy).unwrap();
    assert_eq!(
        (destroy.state, destroy.origin, destroy.exception),
        (Ask, Origin::Action, false)
    );
    assert_eq!(view.restricted, 2);
}

#[test]
fn an_exception_replaces_the_default_in_either_direction() {
    // Allow under an Ask default.
    let saved = [
        default_rule(Action::Send, Ask),
        group_rule("email", Action::Send, Always),
    ];
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Always, Origin::GroupAction)
    );
    // Deny under an Allow default.
    let saved = [group_rule("documents", Action::Destroy, Never)];
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_document"),
        (Never, Origin::GroupAction)
    );
    let view = view_of(&catalog(), saved.to_vec(), None);
    let destroy = pair(&view, "documents", Action::Destroy).unwrap();
    assert_eq!((destroy.state, destroy.exception), (Never, true));
}

#[test]
fn an_explicit_exception_equal_to_the_default_is_kept_and_survives_a_default_change() {
    let catalog = catalog();
    // A person's Allow on Email · Send is stored, though Allow is the
    // default.
    let changes = normalize(
        vec![change(group_action("email", Action::Send), Some(Always))],
        false,
    );
    assert_eq!(changes[0].state, Some(Always));
    let saved = apply(&[], &changes, SetBy::Person);
    let view = view_of(&catalog, saved.clone(), None);
    let send = pair(&view, "email", Action::Send).unwrap();
    assert_eq!(
        (send.state, send.origin, send.exception),
        (Always, Origin::GroupAction, true)
    );

    // The Send default becomes Ask: Email keeps its Allow.
    let default = normalize(vec![change(default_target(Action::Send), Some(Ask))], false);
    let saved = apply(&saved, &default, SetBy::Person);
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Always, Origin::GroupAction)
    );

    // Removing the exception falls back to the default.
    let removal = normalize(
        vec![change(group_action("email", Action::Send), None)],
        false,
    );
    let saved = apply(&saved, &removal, SetBy::Person);
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Ask, Origin::Action)
    );
    assert!(
        !pair(&view_of(&catalog, saved, None), "email", Action::Send)
            .unwrap()
            .exception
    );
}

#[test]
fn a_default_of_always_is_never_stored() {
    for restriction in [false, true] {
        let changes = normalize(
            vec![change(default_target(Action::Send), Some(Always))],
            restriction,
        );
        assert_eq!(changes[0].state, None);
    }
    // A restriction stores no always on an exception either.
    let changes = normalize(
        vec![change(group_action("email", Action::Send), Some(Always))],
        true,
    );
    assert_eq!(changes[0].state, None);
}

#[test]
fn a_new_entity_type_inherits_each_action_default() {
    let saved = vec![
        default_rule(Action::Send, Ask),
        default_rule(Action::Destroy, Never),
    ];
    // A registry that adds `tasks`, with operations no rule names.
    let mut catalog = catalog();
    catalog.groups.push(group("tasks"));
    catalog
        .entries
        .push(entry("storage", "send_task", "tasks", Action::Send));
    catalog
        .entries
        .push(entry("storage", "delete_task", "tasks", Action::Destroy));
    catalog
        .entries
        .push(entry("storage", "get_task", "tasks", Action::Read));
    let layer = Layer::new(&saved);
    let resolve = |operation: &str| {
        effective(
            &layer,
            &Layer::default(),
            catalog.entry("storage", operation).unwrap(),
        )
    };
    assert_eq!(resolve("send_task"), (Ask, Origin::Action));
    assert_eq!(resolve("delete_task"), (Never, Origin::Action));
    assert_eq!(resolve("get_task"), (Always, Origin::Default));
}

#[test]
fn a_default_on_a_pair_with_no_tool_applies_once_a_tool_maps_there() {
    // Documents has no Send operation yet; the Send default is Ask.
    let saved = vec![default_rule(Action::Send, Ask)];
    assert_eq!(
        pair_state(
            &Layer::new(&saved),
            &Layer::default(),
            "documents",
            Action::Send
        ),
        (Ask, Origin::Action)
    );
    let mut catalog = catalog();
    catalog.entries.push(entry(
        "storage",
        "share_document",
        "documents",
        Action::Send,
    ));
    let send = pair(&view_of(&catalog, saved, None), "documents", Action::Send)
        .cloned()
        .unwrap();
    assert_eq!(
        (send.state, send.origin, send.exception),
        (Ask, Origin::Action, false)
    );
}

#[test]
fn tool_rules_sit_under_the_exception_and_the_default() {
    // A person's tool setting replaces both.
    let saved = [
        default_rule(Action::Destroy, Never),
        group_rule("documents", Action::Destroy, Never),
        tool_rule("storage", "delete_project", Always),
    ];
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_project"),
        (Always, Origin::Tool)
    );
    // Without an exception, a person's tool setting replaces the default.
    let saved = [
        default_rule(Action::Destroy, Never),
        tool_rule("storage", "delete_project", Ask),
    ];
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_project"),
        (Ask, Origin::Tool)
    );
    // The agent's tool setting takes the stricter of itself and the default.
    let saved = [
        default_rule(Action::Destroy, Never),
        agent_tool_rule("storage", "delete_project", Ask),
    ];
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_project"),
        (Never, Origin::Action)
    );
    let saved = [
        default_rule(Action::Destroy, Ask),
        agent_tool_rule("storage", "delete_project", Never),
    ];
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_project"),
        (Never, Origin::Tool)
    );
    // And of its group's exception, when it has one.
    let saved = [
        default_rule(Action::Destroy, Never),
        group_rule("documents", Action::Destroy, Always),
        agent_tool_rule("storage", "delete_project", Ask),
    ];
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_project"),
        (Ask, Origin::Tool)
    );
    assert_eq!(
        state_of(&saved, &[], "storage", "delete_document"),
        (Always, Origin::GroupAction)
    );
}

#[test]
fn an_agents_exception_never_exempts_a_group_from_a_stricter_default() {
    // The agent restricts Email · Send to Ask; a person later sets the Send
    // default to Never. The agent's row only adds, so Email follows Never.
    let saved = [
        agent_group_rule("email", Action::Send, Ask),
        default_rule(Action::Send, Never),
    ];
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Never, Origin::Action)
    );
    let view = view_of(&catalog(), saved.to_vec(), None);
    let send = pair(&view, "email", Action::Send).unwrap();
    assert_eq!(
        (send.state, send.origin, send.exception),
        (Never, Origin::Action, true)
    );
    // Under a laxer default it is the stricter.
    let saved = [
        agent_group_rule("email", Action::Send, Ask),
        default_rule(Action::Send, Always),
    ];
    assert_eq!(
        state_of(&saved, &[], "email", "send_email"),
        (Ask, Origin::GroupAction)
    );
}

#[test]
fn a_sessions_default_only_makes_things_stricter() {
    let saved = [
        default_rule(Action::Send, Ask),
        group_rule("email", Action::Send, Always),
    ];
    let overlay = [Rule {
        via_agent: true,
        restriction_only: true,
        ..default_rule(Action::Send, Never)
    }];
    assert_eq!(
        state_of(&saved, &overlay, "email", "send_email"),
        (Never, Origin::Session)
    );
    let view = view_of(&catalog(), saved.to_vec(), Some(overlay.to_vec()));
    assert!(defaults_of(&view).contains(&(Action::Send, Never, Origin::Session)));
    let send = pair(&view, "email", Action::Send).unwrap();
    assert_eq!((send.state, send.origin), (Never, Origin::Session));
}

#[test]
fn tightening_cannot_loosen_a_hidden_pair_or_a_default() {
    // Lowering a default no operation follows today (every documents
    // destroy has an exception) is still refused.
    let saved = [
        default_rule(Action::Destroy, Never),
        group_rule("documents", Action::Destroy, Never),
    ];
    let lower = vec![change(default_target(Action::Destroy), Some(Ask))];
    assert_eq!(tighten(&saved, lower.clone()), Err(Vec::new()));
    assert!(asks_looser(&catalog(), (&saved, &[]), &lower).is_err());
    let removal = vec![change(default_target(Action::Destroy), None)];
    assert_eq!(tighten(&saved, removal), Err(Vec::new()));

    // Loosening an exception on a pair no operation maps to.
    let saved = [group_rule("documents", Action::Send, Never)];
    let loosen = vec![change(group_action("documents", Action::Send), Some(Ask))];
    assert_eq!(tighten(&saved, loosen), Err(Vec::new()));

    // An explicit Allow exception that hides a stricter default from a
    // pair no operation maps to.
    let saved = [default_rule(Action::Send, Never)];
    let allow = vec![change(
        group_action("documents", Action::Send),
        Some(Always),
    )];
    assert_eq!(tighten(&saved, allow.clone()), Err(Vec::new()));

    // Tightening a default or a hidden pair passes.
    assert_eq!(
        tighten(&[], vec![change(default_target(Action::Send), Some(Ask))]),
        Ok(())
    );
    assert_eq!(
        tighten(
            &[],
            vec![change(group_action("documents", Action::Send), Some(Never))]
        ),
        Ok(())
    );
}

#[test]
fn removing_an_exception_asks_for_the_default() {
    let catalog = catalog();
    // Removing a Never exception under an Ask default asks for Ask.
    let saved = [
        default_rule(Action::Send, Ask),
        group_rule("email", Action::Send, Never),
    ];
    let removal = [change(group_action("email", Action::Send), None)];
    let refused = asks_looser(&catalog, (&saved, &[]), &removal).unwrap_err();
    assert_eq!((refused[0].from, refused[0].to), (Never, Ask));

    // Removing an Ask exception under a Never default asks for something
    // stricter: allowed.
    let saved = [
        default_rule(Action::Send, Never),
        group_rule("email", Action::Send, Ask),
    ];
    assert_eq!(asks_looser(&catalog, (&saved, &[]), &removal), Ok(()));

    // Removing a default asks for always; the operations that follow it are
    // named.
    let saved = [default_rule(Action::Destroy, Ask)];
    let refused = asks_looser(
        &catalog,
        (&saved, &[]),
        &[change(default_target(Action::Destroy), None)],
    )
    .unwrap_err();
    let named: Vec<&str> = refused.iter().map(|op| op.operation.as_str()).collect();
    assert_eq!(named, ["delete_document", "delete_project"]);
    assert!(refused.iter().all(|op| (op.from, op.to) == (Ask, Always)));
}

#[test]
fn every_default_is_a_known_target() {
    let changes: Vec<Change> = Action::ALL
        .into_iter()
        .map(|action| change(default_target(action), Some(Never)))
        .collect();
    assert!(unknown_targets(&catalog(), &changes).is_empty());
}

#[test]
fn the_view_serializes_its_defaults_and_each_pairs_exception() {
    let saved = vec![
        default_rule(Action::Send, Ask),
        group_rule("email", Action::Send, Always),
    ];
    let json = serde_json::to_value(view_of(&catalog(), saved, None)).unwrap();
    assert_eq!(
        json["defaults"][3],
        serde_json::json!({ "action": "send", "state": "ask", "origin": "action" })
    );
    let email = json["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["group"] == "email")
        .unwrap();
    assert_eq!(
        email["actions"][1],
        serde_json::json!({
            "action": "send",
            "state": "always",
            "origin": "group_action",
            "exception": true,
            "tools": 1,
            "overrides": [],
        })
    );
    assert_eq!(
        json["rules"][0]["target"],
        serde_json::json!({ "kind": "action", "action": "send" })
    );
    let parsed: Change = serde_json::from_value(serde_json::json!({
        "target": { "kind": "action", "action": "destroy" },
        "state": "never",
    }))
    .unwrap();
    assert_eq!(parsed, change(default_target(Action::Destroy), Some(Never)));
}

/// Resolution as it was before action defaults, kept to pin that every rule
/// set saved then resolves exactly as it did: an operation's person setting,
/// else the stricter of a restriction and its group's action, else its
/// group's action, else always; the overlay's operation and group rows only
/// add.
fn effective_before_defaults(
    saved: &[Rule],
    overlay: &[Rule],
    entry: &CatalogEntry,
) -> (PermissionState, Origin) {
    let group_of = |rules: &[Rule]| {
        rules.iter().find_map(|rule| match &rule.target {
            Target::GroupAction { group, action }
                if *group == entry.group && *action == entry.action =>
            {
                Some(rule.state)
            }
            _ => None,
        })
    };
    let tool_of = |rules: &[Rule]| {
        rules
            .iter()
            .find(|rule| {
                rule.target
                    == Target::Tool {
                        service: entry.service.clone(),
                        operation: entry.operation.clone(),
                    }
            })
            .map(|rule| (rule.state, rule.restriction_only))
    };
    let group = match group_of(saved) {
        Some(state) => (state, Origin::GroupAction),
        None => (Always, Origin::Default),
    };
    let (base, origin) = match tool_of(saved) {
        Some((state, false)) => (state, Origin::Tool),
        Some((state, true)) if state > group.0 => (state, Origin::Tool),
        Some(_) | None => group,
    };
    let extra = tool_of(overlay)
        .map(|(state, _)| state)
        .into_iter()
        .chain(group_of(overlay))
        .max()
        .unwrap_or(Always);
    if extra > base {
        (extra, Origin::Session)
    } else {
        (base, origin)
    }
}

/// A small deterministic generator, so the fixtures are the same each run.
struct Fixtures(u64);

impl Fixtures {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        usize::try_from(self.0 >> 33).unwrap() % below
    }

    /// A rule set the tables before action defaults could hold: no
    /// `action` rows, never `always` on a group's action (and never at all in
    /// an overlay).
    fn rules(&mut self, catalog: &Catalog, overlay: bool) -> Vec<Rule> {
        let mut rules = Vec::new();
        let states = if overlay {
            &[Ask, Never][..]
        } else {
            &[Always, Ask, Never][..]
        };
        let groups = ["documents", "email", "calendar", "tasks"];
        for _ in 0..self.next(6) {
            let group = groups[self.next(groups.len())];
            let action = Action::ALL[self.next(5)];
            let state = [Ask, Never][self.next(2)];
            let restriction = overlay || self.next(2) == 0;
            rules.retain(|rule: &Rule| rule.target != group_action(group, action));
            rules.push(Rule {
                via_agent: restriction,
                restriction_only: restriction,
                ..group_rule(group, action, state)
            });
        }
        for _ in 0..self.next(4) {
            let entry = &catalog.entries[self.next(catalog.entries.len())];
            let state = states[self.next(states.len())];
            let restriction = overlay || self.next(2) == 0;
            let target = tool(&entry.service, &entry.operation);
            rules.retain(|rule: &Rule| rule.target != target);
            rules.push(Rule {
                via_agent: restriction,
                restriction_only: restriction,
                ..tool_rule(&entry.service, &entry.operation, state)
            });
        }
        rules
    }
}

#[test]
fn existing_rule_sets_resolve_exactly_as_before() {
    let catalog = catalog();
    let mut fixtures = Fixtures(0x5eed);
    for _ in 0..5_000 {
        let saved = fixtures.rules(&catalog, false);
        let overlay = fixtures.rules(&catalog, true);
        let (saved_layer, overlay_layer) = (Layer::new(&saved), Layer::new(&overlay));
        for entry in &catalog.entries {
            assert_eq!(
                effective(&saved_layer, &overlay_layer, entry),
                effective_before_defaults(&saved, &overlay, entry),
                "{}.{} under {saved:?} and {overlay:?}",
                entry.service,
                entry.operation
            );
        }
    }
}

impl Fixtures {
    /// A rule set with defaults and explicit exceptions of any state, as the
    /// tables hold them now.
    fn rules_with_defaults(&mut self, catalog: &Catalog, overlay: bool) -> Vec<Rule> {
        let mut rules = self.rules(catalog, overlay);
        for _ in 0..self.next(3) {
            let action = Action::ALL[self.next(5)];
            let state = [Ask, Never][self.next(2)];
            rules.retain(|rule: &Rule| rule.target != default_target(action));
            rules.push(Rule {
                via_agent: overlay,
                restriction_only: overlay,
                ..default_rule(action, state)
            });
        }
        if !overlay && self.next(2) == 0 {
            let group = ["documents", "email", "calendar"][self.next(3)];
            let action = Action::ALL[self.next(5)];
            rules.retain(|rule: &Rule| rule.target != group_action(group, action));
            rules.push(group_rule(group, action, Always));
        }
        rules
    }
}

#[test]
fn the_view_and_the_gate_agree_for_every_operation() {
    let catalog = catalog();
    let mut fixtures = Fixtures(0xdefa);
    for _ in 0..2_000 {
        let saved = fixtures.rules_with_defaults(&catalog, false);
        let overlay = fixtures.rules_with_defaults(&catalog, true);
        let view = view_of(&catalog, saved.clone(), Some(overlay.clone()));
        let (saved_layer, overlay_layer) = (Layer::new(&saved), Layer::new(&overlay));
        let mut restricted = 0;
        for entry in &catalog.entries {
            let listed = pair(&view, &entry.group, entry.action).unwrap();
            let shown = listed
                .overrides
                .iter()
                .find(|item| item.service == entry.service && item.operation == entry.operation)
                .map_or(listed.state, |item| item.state);
            // Origins may differ where an operation's own setting equals its
            // pair's: the view lists it under the pair.
            let gate = effective(&saved_layer, &overlay_layer, entry);
            assert_eq!(
                shown, gate.0,
                "{}.{} under {saved:?} and {overlay:?}",
                entry.service, entry.operation
            );
            if gate.0 != Always {
                restricted += 1;
            }
        }
        assert_eq!(view.restricted, restricted);
    }
}
