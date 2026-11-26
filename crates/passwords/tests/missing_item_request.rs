//! Isolated domain fixtures. This test target compiles without database test fixtures.

use chrono::DateTime;
use macro_authorization::{CredentialOrigin, MacroUserAuthentication};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_user::UserContext;
use passwords::domain::{
    agent::{DirectoryAgent, missing_item::*},
    models::{
        Actor, Grant, GranteeKind, ItemId, ItemKind, ItemMetadata, Permission, Record, TeamId,
    },
};
use uuid::Uuid;

const TEAM: TeamId = TeamId(Uuid::from_u128(1));
const OTHER_TEAM: TeamId = TeamId(Uuid::from_u128(2));
const ITEM: ItemId = ItemId(Uuid::from_u128(3));
const INTENT: Uuid = Uuid::from_u128(4);
const AGENT: &str = "macro|agent@example.com";
const HUMAN: &str = "macro|reviewer@example.com";
const OTHER: &str = "macro|other@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn auth(id: &str, origin: CredentialOrigin) -> MacroUserAuthentication {
    MacroUserAuthentication {
        origin,
        agent_id: None,
        agent_via: None,
        routine_id: None,
        macro_user_id: user(id),
        user_context: UserContext::default(),
    }
}

struct Fixture {
    actor: Actor,
    agent: DirectoryAgent,
    scope: MissingItemScope,
}

impl Fixture {
    fn new(kind: MissingItemKind) -> Self {
        Self {
            actor: Actor {
                user_id: user(HUMAN),
            },
            agent: DirectoryAgent {
                agent_user_id: user(AGENT),
                team_id: TEAM,
                owner_user_id: user(HUMAN),
                enabled: true,
                computer_live: true,
            },
            scope: MissingItemScope {
                id: Uuid::from_u128(5),
                team: TEAM,
                agent: user(AGENT),
                kind,
            },
        }
    }

    fn request(&self) -> MissingItemRequest {
        MissingItemRequest::open(
            self.scope.clone(),
            &auth(AGENT, CredentialOrigin::UserApiKey),
            &self.agent,
            true,
            self.actor.user_id.clone(),
        )
        .unwrap()
    }

    fn current(&self) -> CurrentReview<'_> {
        CurrentReview {
            actor: &self.actor,
            team: TEAM,
            human_role: Some(HumanTeamRole::Member),
            review_enabled: true,
            agent: Some(&self.agent),
        }
    }

    fn review(&self, request: &MissingItemRequest) -> MissingItemReviewReceipt {
        request
            .review(
                &self.scope,
                &auth(HUMAN, CredentialOrigin::Session),
                &self.current(),
            )
            .unwrap()
    }
}

fn item(kind: ItemKind) -> Record {
    Record {
        metadata: ItemMetadata {
            id: ITEM,
            team_id: TEAM,
            name: "Fixture credential".to_owned(),
            kind,
            url: None,
            folder_id: None,
            favorite: false,
            version: 1,
            has_totp: false,
            shared: false,
            share_count: 0,
            created_at: DateTime::UNIX_EPOCH,
            updated_at: DateTime::UNIX_EPOCH,
            last_used_at: None,
        },
        user_id: user(HUMAN),
        grants: Vec::new(),
        deleting: false,
        revision: 1,
        totp_key_id: None,
    }
}

const ADD: MissingItemDecision = MissingItemDecision::Add {
    item: ITEM,
    permission: Permission::View,
};

#[test]
fn request_requires_the_exact_teammate_key_and_current_directory() {
    let f = Fixture::new(MissingItemKind::Login);
    for (key, directory, flag) in [
        (
            auth(OTHER, CredentialOrigin::UserApiKey),
            f.agent.clone(),
            true,
        ),
        (
            auth(AGENT, CredentialOrigin::Session),
            f.agent.clone(),
            true,
        ),
        (
            auth(AGENT, CredentialOrigin::UserApiKey),
            DirectoryAgent {
                team_id: OTHER_TEAM,
                ..f.agent.clone()
            },
            true,
        ),
        (
            auth(AGENT, CredentialOrigin::UserApiKey),
            DirectoryAgent {
                enabled: false,
                ..f.agent.clone()
            },
            true,
        ),
        (
            auth(AGENT, CredentialOrigin::UserApiKey),
            f.agent.clone(),
            false,
        ),
    ] {
        assert!(matches!(
            MissingItemRequest::open(f.scope.clone(), &key, &directory, flag, user(HUMAN)),
            Err(RequestUnavailable)
        ));
    }
}

#[test]
fn review_is_personal_and_scoped_to_exact_request_team_agent_and_kind() {
    let f = Fixture::new(MissingItemKind::Login);
    let request = f.request();
    let session = auth(HUMAN, CredentialOrigin::Session);
    for scope in [
        MissingItemScope {
            id: Uuid::nil(),
            ..f.scope.clone()
        },
        MissingItemScope {
            team: OTHER_TEAM,
            ..f.scope.clone()
        },
        MissingItemScope {
            agent: user(OTHER),
            ..f.scope.clone()
        },
        MissingItemScope {
            kind: MissingItemKind::Api,
            ..f.scope.clone()
        },
    ] {
        assert!(matches!(
            request.review(&scope, &session, &f.current()),
            Err(RequestUnavailable)
        ));
    }
    let automation = MacroUserAuthentication {
        routine_id: Some(INTENT),
        ..session.clone()
    };
    for credential in [
        auth(HUMAN, CredentialOrigin::UserApiKey),
        auth(OTHER, CredentialOrigin::Session),
        automation,
    ] {
        assert!(matches!(
            request.review(&f.scope, &credential, &f.current()),
            Err(RequestUnavailable)
        ));
    }
    let agent_account = Actor {
        user_id: user(AGENT),
    };
    let contradictory_facts = CurrentReview {
        actor: &agent_account,
        human_role: Some(HumanTeamRole::Admin),
        ..f.current()
    };
    assert!(matches!(
        request.review(
            &f.scope,
            &auth(AGENT, CredentialOrigin::Session),
            &contradictory_facts
        ),
        Err(RequestUnavailable)
    ));

    let receipt = f.review(&request);
    assert_eq!(
        request.status(
            &receipt,
            &CurrentReview {
                human_role: None,
                ..f.current()
            }
        ),
        Err(RequestUnavailable)
    );
    assert_eq!(
        request.status(
            &receipt,
            &CurrentReview {
                review_enabled: false,
                ..f.current()
            }
        ),
        Err(RequestUnavailable)
    );
    let prior_agent = DirectoryAgent {
        computer_live: false,
        ..f.agent.clone()
    };
    assert_eq!(
        request.status(
            &receipt,
            &CurrentReview {
                agent: Some(&prior_agent),
                ..f.current()
            }
        ),
        Err(RequestUnavailable)
    );
}

#[test]
fn candidates_require_management_exact_kind_and_actual_absence_of_agent_grant() {
    let f = Fixture::new(MissingItemKind::Login);
    let request = f.request();
    let receipt = f.review(&request);
    let mut granted = item(ItemKind::Login);
    granted.grants.push(Grant {
        kind: GranteeKind::Agent,
        id: AGENT.to_owned(),
        permission: Permission::View,
    });
    let mut direct_edit = item(ItemKind::Login);
    direct_edit.user_id = user(OTHER);
    direct_edit.grants.push(Grant {
        kind: GranteeKind::User,
        id: HUMAN.to_owned(),
        permission: Permission::Edit,
    });
    let mut other_team = item(ItemKind::Login);
    other_team.metadata.team_id = OTHER_TEAM;
    let deleting = Record {
        deleting: true,
        ..item(ItemKind::Login)
    };
    let records = [
        item(ItemKind::Api),
        item(ItemKind::Card),
        granted,
        direct_edit.clone(),
        other_team,
        deleting,
        item(ItemKind::Login),
    ];

    assert_eq!(
        request
            .candidates(&receipt, &f.current(), &records)
            .unwrap(),
        [MissingItemCandidate {
            item: ITEM,
            name: "Fixture credential".to_owned()
        }]
    );
    let admin = CurrentReview {
        human_role: Some(HumanTeamRole::Admin),
        ..f.current()
    };
    assert_eq!(
        request
            .candidates(&receipt, &admin, &[direct_edit])
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn add_rechecks_item_binding_and_grants_then_replays_only_the_exact_intent() {
    let f = Fixture::new(MissingItemKind::Login);
    let mut request = f.request();
    let receipt = f.review(&request);
    let mut record = item(ItemKind::Login);
    assert_eq!(
        request
            .candidates(&receipt, &f.current(), &[record.clone()])
            .unwrap()
            .len(),
        1
    );

    record.grants.push(Grant {
        kind: GranteeKind::Agent,
        id: AGENT.to_owned(),
        permission: Permission::Edit,
    });
    assert_eq!(
        request.decide(&receipt, &f.current(), INTENT, ADD, Some(&record)),
        Err(RequestUnavailable)
    );
    record.grants.clear();
    let mut wrong = record.clone();
    wrong.metadata.id = ItemId(Uuid::nil());
    assert_eq!(
        request.decide(&receipt, &f.current(), INTENT, ADD, Some(&wrong)),
        Err(RequestUnavailable)
    );

    let reassigned = Record {
        user_id: user(OTHER),
        ..record.clone()
    };
    assert_eq!(
        request.decide(&receipt, &f.current(), INTENT, ADD, Some(&reassigned)),
        Err(RequestUnavailable)
    );

    assert_eq!(
        request.decide(&receipt, &f.current(), INTENT, ADD, Some(&record)),
        Ok(DecisionResult::Recorded)
    );
    assert!(record.grants.is_empty());
    assert_eq!(
        request.decide(&receipt, &f.current(), INTENT, ADD, Some(&record)),
        Ok(DecisionResult::Replayed)
    );
    let different_intent = Uuid::from_u128(10);
    assert_eq!(
        request.decide(&receipt, &f.current(), different_intent, ADD, Some(&record)),
        Err(RequestUnavailable)
    );
    let changed_permission = MissingItemDecision::Add {
        item: ITEM,
        permission: Permission::Edit,
    };
    assert_eq!(
        request.decide(
            &receipt,
            &f.current(),
            INTENT,
            changed_permission,
            Some(&record)
        ),
        Err(RequestUnavailable)
    );
    let revoked = CurrentReview {
        human_role: None,
        ..f.current()
    };
    assert_eq!(
        request.decide(&receipt, &revoked, INTENT, ADD, Some(&record)),
        Err(RequestUnavailable)
    );
}

#[test]
fn decline_is_addressed_or_admin_and_a_terminal_decision_cannot_be_replaced() {
    let f = Fixture::new(MissingItemKind::Api);
    let mut request = f.request();
    let other = Actor {
        user_id: user(OTHER),
    };
    let mut current = CurrentReview {
        actor: &other,
        ..f.current()
    };
    let other_session = auth(OTHER, CredentialOrigin::Session);
    assert!(matches!(
        request.review(&f.scope, &other_session, &current),
        Err(RequestUnavailable)
    ));

    current.human_role = Some(HumanTeamRole::Admin);
    let admin = request.review(&f.scope, &other_session, &current).unwrap();
    let addressed = f.review(&request);
    assert_eq!(
        request.decide(&admin, &current, INTENT, MissingItemDecision::Decline, None),
        Ok(DecisionResult::Recorded)
    );
    assert_eq!(
        request.decide(&admin, &current, INTENT, MissingItemDecision::Decline, None),
        Ok(DecisionResult::Replayed)
    );
    assert_eq!(
        request.decide(
            &addressed,
            &f.current(),
            INTENT,
            MissingItemDecision::Decline,
            None
        ),
        Err(RequestUnavailable)
    );
    assert_eq!(
        request.decide(
            &addressed,
            &f.current(),
            INTENT,
            ADD,
            Some(&item(ItemKind::Api))
        ),
        Err(RequestUnavailable)
    );
}

#[test]
fn card_can_await_a_human_but_cannot_expose_candidates_or_select_an_agent_item() {
    let f = Fixture::new(MissingItemKind::Card);
    let mut request = f.request();
    let receipt = f.review(&request);
    let mut card = item(ItemKind::Card);
    assert_eq!(
        request.status(&receipt, &f.current()),
        Ok(MissingItemStatus::AwaitingHuman)
    );
    assert!(
        request
            .candidates(
                &receipt,
                &f.current(),
                &[card.clone(), item(ItemKind::Login)]
            )
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        request.decide(&receipt, &f.current(), INTENT, ADD, Some(&card)),
        Err(RequestUnavailable)
    );
    assert!(card.grants.is_empty());
    card.metadata.kind = ItemKind::Login;
    assert_eq!(
        request.decide(&receipt, &f.current(), INTENT, ADD, Some(&card)),
        Err(RequestUnavailable)
    );
    assert_eq!(
        request.decide(
            &receipt,
            &f.current(),
            INTENT,
            MissingItemDecision::Decline,
            None
        ),
        Ok(DecisionResult::Recorded)
    );
}
