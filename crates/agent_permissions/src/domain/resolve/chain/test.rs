use bot_id::BotId;
use chrono::DateTime;

use super::*;
use crate::domain::model::{
    CatalogGroup, Follows, PermissionState::*, PolicyId, PolicyLevel, PolicyOwner,
};
use crate::domain::resolve::{effective, tighten_only};

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

/// Three groups; `calendar` has no send operation, so its send pair is
/// hidden.
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

fn row(target: Target, state: PermissionState, restriction_only: bool) -> Rule {
    Rule {
        target,
        state,
        via_agent: restriction_only,
        restriction_only,
        updated_at: DateTime::UNIX_EPOCH,
    }
}

fn default_target(action: Action) -> Target {
    Target::Action { action }
}

fn pair_target(group: &str, action: Action) -> Target {
    Target::GroupAction {
        group: group.to_owned(),
        action,
    }
}

fn tool_target(service: &str, operation: &str) -> Target {
    Target::Tool {
        service: service.to_owned(),
        operation: operation.to_owned(),
    }
}

/// A chain of policies with `rules`, `rules[0]` the follower's, each
/// following the next; the last owns its settings, or lost its source.
fn chain_of(rules: Vec<Vec<Rule>>, lost: bool) -> PolicyChain {
    let ids: Vec<PolicyId> = rules.iter().map(|_| PolicyId::generate()).collect();
    let count = rules.len();
    let levels = rules
        .into_iter()
        .enumerate()
        .map(|(index, rules)| PolicyLevel {
            id: ids[index],
            owner: PolicyOwner::Agent(BotId::TEST_A),
            follows: match ids.get(index + 1) {
                Some(next) => Follows::Source(*next),
                None if lost => Follows::Lost,
                None => Follows::Own,
            },
            rules,
        })
        .collect::<Vec<_>>();
    assert_eq!(levels.len(), count);
    PolicyChain::new(levels).unwrap()
}

fn entry_state(resolver: &Resolver, service: &str, operation: &str) -> (PermissionState, Origin) {
    let catalog = catalog();
    resolver.entry(catalog.entry(service, operation).unwrap())
}

#[test]
fn a_follower_resolves_through_its_source_live() {
    let follower: Vec<Rule> = Vec::new();
    let before = chain_of(vec![follower.clone(), Vec::new()], false);
    let resolver = Resolver::new(&before, &[]);
    assert_eq!(
        entry_state(&resolver, "email", "send_email"),
        (Always, Origin::Source)
    );

    // The source's next state is what the follower resolves to next.
    let after = chain_of(
        vec![
            follower,
            vec![row(pair_target("email", Action::Send), Never, false)],
        ],
        false,
    );
    let resolver = Resolver::new(&after, &[]);
    assert_eq!(
        entry_state(&resolver, "email", "send_email"),
        (Never, Origin::Source)
    );
    assert_eq!(
        resolver.pair("email", Action::Send),
        (Never, Origin::Source)
    );
    // An Allow exception at the source opens the pair under its Ask
    // default.
    let chain = chain_of(
        vec![
            Vec::new(),
            vec![
                row(default_target(Action::Send), Ask, false),
                row(pair_target("email", Action::Send), Always, false),
            ],
        ],
        false,
    );
    let resolver = Resolver::new(&chain, &[]);
    assert_eq!(resolver.default(Action::Send), (Ask, Origin::Source));
    assert_eq!(
        entry_state(&resolver, "email", "send_email"),
        (Always, Origin::Source)
    );
}

#[test]
fn nested_chains_resolve_to_the_root_with_each_levels_restrictions() {
    // Analyst follows Scout, which follows Macro (the root).
    let macro_rules = vec![
        row(default_target(Action::Destroy), Ask, false),
        row(pair_target("email", Action::Send), Ask, false),
    ];
    let scout = vec![row(tool_target("storage", "delete_project"), Never, true)];
    let analyst = vec![row(default_target(Action::Create), Ask, true)];
    let chain = chain_of(
        vec![analyst.clone(), scout.clone(), macro_rules.clone()],
        false,
    );
    let resolver = Resolver::new(&chain, &[]);
    assert_eq!(
        entry_state(&resolver, "storage", "delete_document"),
        (Ask, Origin::Source)
    );
    assert_eq!(
        entry_state(&resolver, "storage", "delete_project"),
        (Never, Origin::Source)
    );
    assert_eq!(
        entry_state(&resolver, "email", "send_email"),
        (Ask, Origin::Source)
    );
    assert_eq!(
        entry_state(&resolver, "storage", "create_document"),
        (Ask, Origin::Action)
    );
    assert_eq!(
        entry_state(&resolver, "calendar", "create_event"),
        (Ask, Origin::Action)
    );

    // Scout detaches: it now owns the snapshot of what it resolved to, and
    // Analyst still follows it and resolves exactly as before.
    let scouts_chain = chain_of(vec![scout, macro_rules], false);
    let scout_own = materialize(&catalog(), &scouts_chain);
    let detached = chain_of(vec![analyst, scout_own], false);
    let after = Resolver::new(&detached, &[]);
    for entry in &catalog().entries {
        assert_eq!(resolver.entry(entry).0, after.entry(entry).0, "{entry:?}");
    }
}

#[test]
fn a_local_restriction_takes_the_stricter_state() {
    let source = vec![
        row(pair_target("email", Action::Send), Ask, false),
        row(pair_target("documents", Action::Destroy), Never, false),
    ];
    // A person's row on a follower is a restriction too: an Allow loosens
    // nothing.
    let follower = vec![
        row(tool_target("email", "send_email"), Never, true),
        row(pair_target("documents", Action::Destroy), Always, false),
    ];
    let chain = chain_of(vec![follower, source], false);
    let resolver = Resolver::new(&chain, &[]);
    assert_eq!(
        entry_state(&resolver, "email", "send_email"),
        (Never, Origin::Tool)
    );
    assert_eq!(
        entry_state(&resolver, "storage", "delete_document"),
        (Never, Origin::Source)
    );
    // The session overlay still restricts on top.
    let overlay = vec![row(default_target(Action::Read), Ask, true)];
    let resolver = Resolver::new(&chain, &overlay);
    assert_eq!(
        entry_state(&resolver, "email", "list_threads"),
        (Ask, Origin::Session)
    );
}

#[test]
fn a_lost_source_asks_for_everything() {
    let chain = chain_of(
        vec![vec![row(tool_target("email", "send_email"), Never, true)]],
        true,
    );
    let resolver = Resolver::new(&chain, &[]);
    for action in Action::ALL {
        assert_eq!(resolver.default(action), (Ask, Origin::Source));
        assert_eq!(resolver.pair("tasks", action), (Ask, Origin::Source));
    }
    assert_eq!(
        entry_state(&resolver, "storage", "create_document"),
        (Ask, Origin::Source)
    );
    // Its own restriction still applies.
    assert_eq!(
        entry_state(&resolver, "email", "send_email"),
        (Never, Origin::Tool)
    );
    // Through a follower too.
    let chain = chain_of(vec![Vec::new(), Vec::new()], true);
    let resolver = Resolver::new(&chain, &[]);
    assert_eq!(
        entry_state(&resolver, "email", "send_email"),
        (Ask, Origin::Source)
    );
}

#[test]
fn an_own_policy_resolves_as_before() {
    let mut fixtures = Fixtures(0x0aa1);
    let catalog = catalog();
    for _ in 0..2_000 {
        let saved = fixtures.rules(&catalog, true);
        let overlay = fixtures.overlay(&catalog);
        let resolver = Resolver::own(&saved, &overlay);
        let (saved_layer, overlay_layer) = (Layer::new(&saved), Layer::new(&overlay));
        for entry in &catalog.entries {
            assert_eq!(
                resolver.entry(entry),
                effective(&saved_layer, &overlay_layer, entry)
            );
        }
    }
}

#[test]
fn tightening_a_follower_cannot_loosen_through_its_chain() {
    let source = vec![row(pair_target("email", Action::Send), Ask, false)];
    let local = vec![row(tool_target("email", "send_email"), Never, true)];
    let chain = chain_of(vec![local, source], false);
    let before = Resolver::new(&chain, &[]);
    let removed: Vec<Rule> = Vec::new();
    let after = Resolver::with_rules(&chain, &removed, &[]);
    let loosened = tighten_only(&catalog(), &before, &after).unwrap_err();
    assert_eq!(
        loosened
            .iter()
            .map(|op| (op.operation.as_str(), op.from, op.to))
            .collect::<Vec<_>>(),
        [("send_email", Never, Ask)]
    );
    // A stricter local default is a tightening.
    let stricter = vec![
        row(tool_target("email", "send_email"), Never, true),
        row(default_target(Action::Read), Never, true),
    ];
    let after = Resolver::with_rules(&chain, &stricter, &[]);
    assert_eq!(tighten_only(&catalog(), &before, &after), Ok(()));
}

#[test]
fn detach_excludes_session_overlays_and_approvals() {
    // An overlay is not part of a chain, so the snapshot holds nothing of
    // it: the follower's saved rules after a detach resolve as the chain
    // did without its session.
    let chain = chain_of(
        vec![
            Vec::new(),
            vec![row(pair_target("email", Action::Send), Ask, false)],
        ],
        false,
    );
    let overlay = vec![row(default_target(Action::Read), Never, true)];
    let with_session = Resolver::new(&chain, &overlay);
    assert_eq!(
        entry_state(&with_session, "email", "list_threads"),
        (Never, Origin::Session)
    );
    let snapshot = materialize(&catalog(), &chain);
    assert_eq!(
        snapshot
            .iter()
            .map(|rule| (rule.target.key(), rule.state))
            .collect::<Vec<_>>(),
        [("email:send".to_owned(), Ask)]
    );
    let own = Resolver::own(&snapshot, &[]);
    assert_eq!(
        entry_state(&own, "email", "list_threads"),
        (Always, Origin::Default)
    );
}

#[test]
fn detach_keeps_local_restrictions() {
    let source = vec![row(pair_target("email", Action::Send), Never, false)];
    // The agent's restriction on itself equals the source's state now; it
    // stays a restriction of its own after the detach, so a later person's
    // Allow on the pair doesn't lift it.
    let local = vec![Rule {
        via_agent: true,
        ..row(tool_target("email", "send_email"), Never, true)
    }];
    let chain = chain_of(vec![local, source], false);
    let snapshot = materialize(&catalog(), &chain);
    let kept = snapshot
        .iter()
        .find(|rule| rule.target == tool_target("email", "send_email"))
        .unwrap();
    assert_eq!(
        (kept.state, kept.via_agent, kept.restriction_only),
        (Never, true, true)
    );
    let mut loosened = snapshot.clone();
    loosened.retain(|rule| rule.target != pair_target("email", Action::Send));
    loosened.push(row(pair_target("email", Action::Send), Always, false));
    let own = Resolver::own(&loosened, &[]);
    assert_eq!(
        entry_state(&own, "email", "send_email"),
        (Never, Origin::Tool)
    );
}

#[test]
fn an_explicit_choice_at_the_root_stays_a_persons_choice() {
    let root = vec![
        row(default_target(Action::Send), Ask, false),
        row(pair_target("email", Action::Send), Ask, false),
        row(tool_target("storage", "delete_project"), Always, false),
    ];
    let chain = chain_of(vec![Vec::new(), root], false);
    let snapshot = materialize(&catalog(), &chain);
    let flags = |target: Target| {
        snapshot
            .iter()
            .find(|rule| rule.target == target)
            .map(|rule| (rule.state, rule.restriction_only))
    };
    assert_eq!(
        flags(pair_target("email", Action::Send)),
        Some((Ask, false))
    );
    assert_eq!(
        flags(tool_target("storage", "delete_project")),
        Some((Always, false))
    );
    assert_eq!(flags(default_target(Action::Send)), Some((Ask, false)));
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

    fn coin(&mut self) -> bool {
        self.next(2) == 0
    }

    fn state(&mut self) -> PermissionState {
        [Always, Ask, Never][self.next(3)]
    }

    /// Any rules the tables accept: defaults (never always), exceptions of
    /// any state on catalog groups, a group the catalog lacks (`tasks`) and
    /// a hidden pair, operation rows on catalog operations and on one the
    /// catalog no longer has, each a person's or a restriction (`mixed`).
    fn rules(&mut self, catalog: &Catalog, mixed: bool) -> Vec<Rule> {
        let mut rules: Vec<Rule> = Vec::new();
        let push = |rules: &mut Vec<Rule>, rule: Rule| {
            rules.retain(|earlier| earlier.target != rule.target);
            rules.push(rule);
        };
        for _ in 0..self.next(3) {
            let action = Action::ALL[self.next(5)];
            let state = [Ask, Never][self.next(2)];
            let restriction = mixed && self.coin();
            push(&mut rules, row(default_target(action), state, restriction));
        }
        for _ in 0..self.next(6) {
            let group = ["documents", "email", "calendar", "tasks"][self.next(4)];
            let action = Action::ALL[self.next(5)];
            let state = self.state();
            let restriction = mixed && self.coin();
            push(
                &mut rules,
                row(pair_target(group, action), state, restriction),
            );
        }
        for _ in 0..self.next(4) {
            let (service, operation) = if self.next(6) == 0 {
                ("storage", "retired_operation")
            } else {
                let entry = &catalog.entries[self.next(catalog.entries.len())];
                (entry.service.as_str(), entry.operation.as_str())
            };
            let state = self.state();
            let restriction = mixed && self.coin();
            push(
                &mut rules,
                Rule {
                    via_agent: restriction && self.coin(),
                    ..row(tool_target(service, operation), state, restriction)
                },
            );
        }
        rules
    }

    /// A session overlay: restrictions only, never always.
    fn overlay(&mut self, catalog: &Catalog) -> Vec<Rule> {
        let mut rules = self.rules(catalog, false);
        rules.retain(|rule| rule.state != Always);
        for rule in &mut rules {
            rule.via_agent = true;
            rule.restriction_only = true;
        }
        rules
    }

    /// A chain of one to `MAX_CHAIN` policies; sometimes its root's source
    /// was lost.
    fn chain(&mut self, catalog: &Catalog) -> PolicyChain {
        let depth = 1 + self.next(crate::domain::model::MAX_CHAIN);
        let lost = self.next(5) == 0;
        let levels = (0..depth).map(|_| self.rules(catalog, true)).collect();
        chain_of(levels, lost)
    }
}

/// Every group a resolution can be asked about: the catalog's, those the
/// chain's rows name, and one nobody named.
fn groups_of(catalog: &Catalog, chain: &PolicyChain) -> Vec<String> {
    let mut groups: Vec<String> = catalog
        .groups
        .iter()
        .map(|group| group.id.clone())
        .collect();
    for level in chain.levels() {
        for rule in &level.rules {
            if let Target::GroupAction { group, .. } = &rule.target
                && !groups.contains(group)
            {
                groups.push(group.clone());
            }
        }
    }
    groups.push("never_named".to_owned());
    groups
}

#[test]
fn detach_snapshot_keeps_every_state() {
    let catalog = catalog();
    let mut fixtures = Fixtures(0xde7a);
    for _ in 0..5_000 {
        let chain = fixtures.chain(&catalog);
        let snapshot = materialize(&catalog, &chain);
        for rule in &snapshot {
            // What the tables accept.
            assert!(!rule.via_agent || rule.restriction_only, "{rule:?}");
            assert!(
                !(matches!(rule.target, Target::Action { .. }) && rule.state == Always),
                "{rule:?}"
            );
        }
        let through = Resolver::new(&chain, &[]);
        let own = Resolver::own(&snapshot, &[]);
        for action in Action::ALL {
            assert_eq!(
                own.default(action).0,
                through.default(action).0,
                "{action:?} under {chain:?}"
            );
            for group in groups_of(&catalog, &chain) {
                assert_eq!(
                    own.pair(&group, action).0,
                    through.pair(&group, action).0,
                    "{group}:{action:?} under {chain:?}, snapshot {snapshot:?}"
                );
            }
        }
        for entry in &catalog.entries {
            assert_eq!(
                own.entry(entry).0,
                through.entry(entry).0,
                "{entry:?} under {chain:?}, snapshot {snapshot:?}"
            );
        }
    }
}

#[test]
fn the_view_and_the_gate_agree_through_a_chain() {
    let catalog = catalog();
    let mut fixtures = Fixtures(0x7a1e);
    for _ in 0..2_000 {
        let chain = fixtures.chain(&catalog);
        let overlay = fixtures.overlay(&catalog);
        let view = crate::domain::resolve::view(
            &catalog,
            BotId::TEST_A,
            crate::domain::model::PolicyKind::Agent,
            crate::domain::resolve::ViewAccess {
                can_edit: true,
                can_tighten: true,
            },
            &chain,
            Some(overlay.clone()),
        );
        let gate = Resolver::new(&chain, &overlay);
        for entry in &catalog.entries {
            let listed = view
                .groups
                .iter()
                .find(|group| group.group == entry.group)
                .and_then(|group| {
                    group
                        .actions
                        .iter()
                        .find(|pair| pair.action == entry.action)
                })
                .unwrap();
            let shown = listed
                .overrides
                .iter()
                .find(|item| item.service == entry.service && item.operation == entry.operation)
                .map_or(listed.state, |item| item.state);
            assert_eq!(shown, gate.entry(entry).0, "{entry:?} under {chain:?}");
        }
    }
}
