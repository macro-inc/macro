use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_permissions::share_permission::team_share::TeamShareFacts;
use std::cell::Cell;

const TEAM: uuid::Uuid = uuid::uuid!("10000000-0000-0000-0000-000000000001");

fn snapshot(kind: EntityType) -> Snapshot {
    Snapshot {
        entity: kind.with_entity_string("20000000-0000-0000-0000-000000000002".into()),
        facts: Some(TeamShareFacts {
            entity: kind.with_entity_string("20000000-0000-0000-0000-000000000002".into()),
            owner: MacroUserIdStr::parse_from_str("macro|owner@example.com")
                .unwrap()
                .into_owned(),
            owner_team_id: Some(TEAM),
            current: None,
            revision: 0,
        }),
        direct_grants: vec![DirectGrant {
            team_id: TEAM.to_string(),
            level: AccessLevel::Comment,
        }],
        call_flags: vec![],
        unambiguous_owner_team: true,
    }
}

#[test]
fn documents_require_review_and_preserve_actual_levels() {
    for level in [AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit] {
        let mut s = snapshot(EntityType::Document);
        s.direct_grants[0].level = level;
        assert_eq!(classify(&s, false).action, None);
        assert!(
            classify(&s, false)
                .findings
                .contains(&Finding::UnknownDirectGrant(s.direct_grants[0].clone()))
        );
        assert_eq!(
            classify(&s, true).action,
            Some(Action::Adopt(TeamShareGrant {
                team_id: TEAM,
                level: level.try_into().unwrap()
            }))
        );
    }
}

#[test]
fn legacy_calls_and_disagreements_are_distinct() {
    let mut s = snapshot(EntityType::Call);
    s.call_flags = vec![true];
    assert!(matches!(classify(&s, false).action, Some(Action::Adopt(_))));
    s.direct_grants.clear();
    assert_eq!(
        classify(&s, false).action,
        Some(Action::RepairLegacyCall(TeamShareGrant {
            team_id: TEAM,
            level: TeamShareLevel::View
        }))
    );
    s.unambiguous_owner_team = false;
    assert_eq!(classify(&s, false).action, None);
    s.unambiguous_owner_team = true;
    s.call_flags = vec![true, false];
    assert_eq!(classify(&s, false).action, None);
    assert!(
        classify(&s, false)
            .findings
            .contains(&Finding::CallFlagDisagreement)
    );
    s.call_flags = vec![false];
    s.direct_grants = snapshot(EntityType::Call).direct_grants;
    assert_eq!(classify(&s, false).action, None);
    assert!(
        classify(&s, false)
            .findings
            .contains(&Finding::CallFlagDisagreement)
    );
}

#[test]
fn unknown_owner_stale_and_newer_revisions_are_never_adopted() {
    let mut s = snapshot(EntityType::Document);
    s.direct_grants[0].level = AccessLevel::Owner;
    assert_eq!(classify(&s, true).action, None);
    assert!(matches!(
        classify(&s, true).findings[0],
        Finding::OwnerGrant(_)
    ));
    s.direct_grants[0].level = AccessLevel::Edit;
    s.facts.as_mut().unwrap().owner_team_id = None;
    assert_eq!(classify(&s, true).action, None);
    assert!(matches!(
        classify(&s, true).findings[0],
        Finding::StaleTeamGrant(_)
    ));
    s = snapshot(EntityType::Document);
    s.facts.as_mut().unwrap().revision = 1;
    assert_eq!(classify(&s, true).action, None);
    s.entity.entity_type = EntityType::Project;
    s.facts.as_mut().unwrap().revision = 0;
    assert_eq!(classify(&s, true).action, None);
}

#[test]
fn canonical_verification_is_exact_and_idempotent() {
    let mut s = snapshot(EntityType::Document);
    let grant = TeamShareGrant {
        team_id: TEAM,
        level: TeamShareLevel::View,
    };
    s.facts.as_mut().unwrap().current = Some(grant);
    s.facts.as_mut().unwrap().revision = 3;
    assert_eq!(
        classify(&s, false).action,
        Some(Action::RepairCanonical(grant))
    );
    s.direct_grants[0].level = AccessLevel::View;
    assert_eq!(classify(&s, false).action, None);
    assert!(
        classify(&s, false)
            .findings
            .contains(&Finding::CanonicalVerified)
    );
    s.direct_grants.clear();
    assert_eq!(
        classify(&s, false).action,
        Some(Action::RepairCanonical(grant))
    );
    s.facts.as_mut().unwrap().owner_team_id = None;
    assert_eq!(classify(&s, false).action, None);
}

struct FakeRepository {
    writes: Cell<usize>,
}
impl ReconciliationRepository for FakeRepository {
    async fn scan(
        &self,
        _after: &str,
        _limit: i64,
    ) -> Result<Vec<Entity<'static>>, rootcause::Report> {
        Ok(vec![snapshot(EntityType::Call).entity])
    }
    async fn inspect(&self, _entity: &Entity<'_>) -> Result<Snapshot, rootcause::Report> {
        let mut s = snapshot(EntityType::Call);
        s.call_flags = vec![true];
        Ok(s)
    }
    async fn apply(
        &self,
        _expected: &Snapshot,
        _action: Action,
    ) -> Result<bool, rootcause::Report> {
        self.writes.set(self.writes.get() + 1);
        Ok(true)
    }
}

#[tokio::test]
async fn dry_run_never_calls_the_write_port() {
    let repository = FakeRepository {
        writes: Cell::new(0),
    };
    let options = Options::default();
    let results = reconcile_batch(&repository, &options).await.unwrap();
    assert_eq!(repository.writes.get(), 0);
    assert!(!results[0].applied);
    assert!(!results[0].changed_since_review);
    assert_eq!(
        results[0].cursor,
        cursor(&snapshot(EntityType::Call).entity)
    );
    assert!(results[0].classification.action.is_some());
    reconcile_batch(
        &repository,
        &Options {
            apply: true,
            ..options
        },
    )
    .await
    .unwrap();
    assert_eq!(repository.writes.get(), 1);
}
