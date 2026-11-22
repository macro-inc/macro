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
    assert_eq!(tighten(&saved, changes.clone()), Ok(()));
    // An operation added to documents·destroy later would be always.
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
fn the_catalog_names_destroy_delete_and_lists_tools_by_group() {
    let catalog = catalog_view(&catalog());
    let names: Vec<&str> = catalog.actions.iter().map(|action| action.name).collect();
    assert_eq!(names, ["Create", "Read", "Update", "Delete", "Send"]);
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
