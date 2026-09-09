use super::*;
use model_entity::EntityType;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

fn facts() -> TeamShareFacts {
    TeamShareFacts {
        entity: EntityType::Document.with_entity_string("document-id".to_string()),
        owner: owner(),
        owner_team_id: Some(Uuid::from_u128(1)),
        current: None,
        revision: 7,
    }
}

fn request(level: Option<AccessLevel>) -> TeamShareRequest {
    TeamShareRequest {
        access_level: Some(level),
        legacy_enabled: None,
    }
}

fn authorize(
    facts: &TeamShareFacts,
    request: TeamShareRequest,
) -> Result<Option<AuthorizedTeamShareCommand>, TeamSharePolicyError> {
    authorize_team_share(Some(&owner()), facts, request, TeamShareLevel::Edit)
}

#[test]
fn omission_is_a_no_op_without_an_actor_or_team() {
    let mut facts = facts();
    let team_id = facts.owner_team_id.take().unwrap();
    for current in [
        None,
        Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::Comment,
        }),
    ] {
        facts.current = current;
        assert_eq!(
            authorize_team_share(
                None,
                &facts,
                TeamShareRequest::default(),
                TeamShareLevel::Edit
            ),
            Ok(None)
        );
    }
}

#[test]
fn every_supplied_operation_requires_the_actual_owner() {
    let mut facts = facts();
    facts.current = Some(TeamShareGrant {
        team_id: facts.owner_team_id.unwrap(),
        level: TeamShareLevel::View,
    });
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();
    for request in [
        request(Some(AccessLevel::View)),
        request(Some(AccessLevel::Edit)),
        request(None),
        TeamShareRequest {
            access_level: None,
            legacy_enabled: Some(true),
        },
        TeamShareRequest {
            access_level: None,
            legacy_enabled: Some(false),
        },
    ] {
        assert_eq!(
            authorize_team_share(None, &facts, request, TeamShareLevel::Edit),
            Err(TeamSharePolicyError::MissingActor)
        );
        assert_eq!(
            authorize_team_share(Some(&other), &facts, request, TeamShareLevel::Edit),
            Err(TeamSharePolicyError::NotOwner)
        );
        assert!(authorize(&facts, request).unwrap().is_some());
    }
}

#[test]
fn repeated_clear_without_a_team_still_requires_the_owner() {
    let mut facts = facts();
    facts.owner_team_id = None;
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();
    for request in [
        request(None),
        TeamShareRequest {
            access_level: None,
            legacy_enabled: Some(false),
        },
    ] {
        assert_eq!(
            authorize_team_share(None, &facts, request, TeamShareLevel::Edit),
            Err(TeamSharePolicyError::MissingActor)
        );
        assert_eq!(
            authorize_team_share(Some(&other), &facts, request, TeamShareLevel::Edit),
            Err(TeamSharePolicyError::NotOwner)
        );
        let command = authorize(&facts, request).unwrap().unwrap();
        assert_eq!(command.target(), None);
        assert_eq!(command.next_revision(), facts.revision + 1);
    }
}

#[test]
fn allowed_levels_are_exact_and_commands_capture_all_expected_facts() {
    let facts = facts();
    for level in [AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit] {
        let command = authorize(&facts, request(Some(level))).unwrap().unwrap();
        assert_eq!(command.expected(), &facts);
        assert_eq!(
            command.target(),
            Some(TeamShareGrant {
                team_id: facts.owner_team_id.unwrap(),
                level: TeamShareLevel::try_from(level).unwrap(),
            })
        );
        assert_eq!(command.next_revision(), 8);
    }
}

#[test]
fn same_value_and_repeated_clears_still_produce_revisioned_commands() {
    let mut facts = facts();
    for level in [None, Some(AccessLevel::View)] {
        facts.current = level.map(|level| TeamShareGrant {
            team_id: facts.owner_team_id.unwrap(),
            level: TeamShareLevel::try_from(level).unwrap(),
        });
        let command = authorize(&facts, request(level)).unwrap().unwrap();
        assert_eq!(command.target(), facts.current);
        assert_eq!(command.next_revision(), facts.revision + 1);
    }
}

#[test]
fn enable_requires_a_team_but_clear_retains_historical_attribution() {
    let mut facts = facts();
    facts.current = Some(TeamShareGrant {
        team_id: facts.owner_team_id.take().unwrap(),
        level: TeamShareLevel::Comment,
    });
    for request in [
        request(Some(AccessLevel::View)),
        TeamShareRequest {
            access_level: None,
            legacy_enabled: Some(true),
        },
    ] {
        assert_eq!(
            authorize(&facts, request),
            Err(TeamSharePolicyError::MissingTeam)
        );
    }
    for request in [
        request(None),
        TeamShareRequest {
            access_level: None,
            legacy_enabled: Some(false),
        },
    ] {
        let command = authorize(&facts, request).unwrap().unwrap();
        assert_eq!(command.target(), None);
        assert_eq!(command.expected(), &facts);
    }
}

#[test]
fn owner_level_is_rejected_even_with_a_legacy_toggle() {
    for legacy_enabled in [None, Some(true), Some(false)] {
        assert_eq!(
            authorize(
                &facts(),
                TeamShareRequest {
                    access_level: Some(Some(AccessLevel::Owner)),
                    legacy_enabled,
                }
            ),
            Err(TeamSharePolicyError::InvalidLevel)
        );
    }
    assert_eq!(
        TeamShareLevel::try_from(AccessLevel::Owner),
        Err(TeamSharePolicyError::InvalidLevel)
    );
}

#[test]
fn legacy_enable_uses_entity_default_only_when_unshared() {
    let mut facts = facts();
    let request = TeamShareRequest {
        access_level: None,
        legacy_enabled: Some(true),
    };
    for default in [TeamShareLevel::Edit, TeamShareLevel::View] {
        let command = authorize_team_share(Some(&owner()), &facts, request, default)
            .unwrap()
            .unwrap();
        assert_eq!(command.target().unwrap().level, default);
    }
    for level in [
        TeamShareLevel::View,
        TeamShareLevel::Comment,
        TeamShareLevel::Edit,
    ] {
        facts.current = Some(TeamShareGrant {
            team_id: facts.owner_team_id.unwrap(),
            level,
        });
        let command = authorize(&facts, request).unwrap().unwrap();
        assert_eq!(command.target(), facts.current);
        assert_eq!(command.next_revision(), facts.revision + 1);
    }
}

#[test]
fn legacy_and_explicit_inputs_must_agree_on_enabled_state_not_default_level() {
    let facts = facts();
    for level in [
        None,
        Some(AccessLevel::View),
        Some(AccessLevel::Comment),
        Some(AccessLevel::Edit),
    ] {
        for enabled in [false, true] {
            let result = authorize(
                &facts,
                TeamShareRequest {
                    access_level: Some(level),
                    legacy_enabled: Some(enabled),
                },
            );
            if enabled == level.is_some() {
                let target = result.unwrap().unwrap().target();
                assert_eq!(target.map(|grant| AccessLevel::from(grant.level)), level);
            } else {
                assert_eq!(result, Err(TeamSharePolicyError::ContradictoryInputs));
            }
        }
    }
}

#[test]
fn invalid_or_exhausted_revisions_cannot_produce_commands() {
    let mut facts = facts();
    for revision in [-1, i64::MAX] {
        facts.revision = revision;
        assert_eq!(
            authorize(&facts, request(None)),
            Err(TeamSharePolicyError::InvalidRevision)
        );
    }
}

#[test]
fn creation_contract_distinguishes_ordinary_task_and_call_defaults() {
    let team_id = Uuid::from_u128(1);
    for team in [None, Some(team_id)] {
        assert_eq!(TeamShareCreation::Unshared.resolve(team), Ok(None));
        assert_eq!(
            TeamShareCreation::Call.resolve(team),
            Ok(team.map(|team_id| TeamShareGrant {
                team_id,
                level: TeamShareLevel::View,
            }))
        );
    }
    assert_eq!(
        TeamShareCreation::ExplicitTask.resolve(None),
        Err(TeamSharePolicyError::MissingTeam)
    );
    assert_eq!(
        TeamShareCreation::ExplicitTask.resolve(Some(team_id)),
        Ok(Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::Comment,
        }))
    );
}

#[test]
fn lifecycle_clear_needs_no_actor_or_current_membership() {
    let mut facts = facts();
    facts.current = Some(TeamShareGrant {
        team_id: facts.owner_team_id.take().unwrap(),
        level: TeamShareLevel::Edit,
    });
    let maintenance = TeamShareMaintenance::Clear {
        expected: facts.clone(),
    };
    let TeamShareMaintenance::Clear { expected } = maintenance;
    assert_eq!(expected, facts);
    assert!(expected.current.is_some());
    assert!(expected.owner_team_id.is_none());
}
