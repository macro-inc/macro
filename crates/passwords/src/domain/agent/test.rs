use super::{
    service::{AgentCall, AgentVaultService, Requested, SearchQuery, Written},
    *,
};
use crate::domain::{
    agent::ports::AgentRepository,
    models::*,
    ports::SecretProvider,
    service::{
        PasswordService,
        test::fakes::{FakeAvailability, FakeProvider, FakeRepository},
    },
};
use chrono::{DateTime, TimeDelta, Utc};
use fakes::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

pub(crate) mod fakes;
mod totp_window;

const TEAM: TeamId = TeamId(Uuid::from_u128(0x7e));
const AGENT: &str = "macro|agent@example.test";
const HUMAN: &str = "macro|human@example.test";
const ADMIN: &str = "macro|admin@example.test";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

/// One composed agent service over fakes, with the agent admitted, both
/// flags on and the provider configured.
pub(crate) struct Vault {
    pub(crate) service: AgentVaultService,
    pub(crate) items: Arc<FakeRepository>,
    pub(crate) provider: Arc<FakeProvider>,
    pub(crate) agents: Arc<FakeAgents>,
    pub(crate) directory: Arc<FakeDirectory>,
    pub(crate) availability: Arc<FakeAgentAvailability>,
    pub(crate) sink: Arc<FakeSink>,
}

pub(crate) fn vault() -> Vault {
    let items = Arc::new(FakeRepository::new());
    items.agents.lock().unwrap().insert(AGENT.into());
    items
        .memberships
        .lock()
        .unwrap()
        .insert(HUMAN.into(), vec![TEAM]);
    items
        .memberships
        .lock()
        .unwrap()
        .insert(ADMIN.into(), vec![TEAM]);
    items.admins.lock().unwrap().insert((ADMIN.into(), TEAM));
    let provider = Arc::new(FakeProvider::new());
    let agents = Arc::new(FakeAgents {
        items: items.clone(),
        rows: Mutex::new(HashMap::new()),
        audits: Mutex::new(vec![]),
        events: Mutex::new(vec![]),
        delivered: Mutex::new(vec![]),
        calls: AtomicUsize::new(0),
        admins: Mutex::new(vec![user(ADMIN)]),
        publishers: Mutex::new(HashMap::new()),
        retired: Mutex::new(vec![]),
        deferred: Mutex::new(vec![]),
    });
    let directory = Arc::new(FakeDirectory {
        agent: Mutex::new(Some(DirectoryAgent {
            agent_user_id: user(AGENT),
            team_id: TEAM,
            owner_user_id: user(HUMAN),
            enabled: true,
            computer_live: true,
        })),
        calls: AtomicUsize::new(0),
        revoke_after: Mutex::new(None),
    });
    let availability = Arc::new(FakeAgentAvailability {
        enabled: AtomicBool::new(true),
        configured: AtomicBool::new(true),
        calls: AtomicUsize::new(0),
    });
    let sink = Arc::new(FakeSink {
        delivered: Mutex::new(vec![]),
        failing: Mutex::new(vec![]),
    });
    let service = AgentVaultService {
        vault: Arc::new(PasswordService {
            repository: items.clone(),
            provider: provider.clone(),
            availability: Arc::new(FakeAvailability),
        }),
        agents: agents.clone(),
        directory: directory.clone(),
        availability: availability.clone(),
        events: sink.clone(),
        clock: Arc::new(Utc::now),
    };
    Vault {
        service,
        items,
        provider,
        agents,
        directory,
        availability,
        sink,
    }
}

fn call() -> AgentCall {
    AgentCall {
        key_user: user(AGENT),
        team: TEAM,
        wake: Some(Uuid::now_v7().to_string()),
    }
}

/// A committed item created by `creator` with the given grants and values.
fn insert(
    vault: &Vault,
    id: u128,
    creator: &str,
    kind: ItemKind,
    grants: Vec<Grant>,
    values: SecretValues,
) -> ItemId {
    let now = Utc::now();
    let item = ItemId(Uuid::from_u128(id));
    vault.items.records.lock().unwrap().insert(
        item.0,
        Record {
            user_id: user(creator),
            grants,
            deleting: false,
            revision: 1,
            totp_key_id: None,
            metadata: ItemMetadata {
                id: item,
                team_id: TEAM,
                name: "Item".into(),
                kind,
                url: None,
                folder_id: None,
                favorite: false,
                version: 1,
                has_totp: false,
                shared: true,
                share_count: 0,
                created_at: now,
                updated_at: now,
                last_used_at: None,
            },
        },
    );
    vault
        .provider
        .stored
        .lock()
        .unwrap()
        .insert(item.0, (1, Uuid::now_v7(), values));
    item
}

fn values(username: &str, password: &str) -> SecretValues {
    SecretValues {
        username: SecretString(username.into()),
        password: SecretString(password.into()),
        notes: SecretString("notes ✓".into()),
        fields: vec![
            SecretField {
                label: "PIN".into(),
                value: SecretString("1".into()),
            },
            SecretField {
                label: "PIN".into(),
                value: SecretString("2".into()),
            },
        ],
    }
}

fn team_edit() -> Grant {
    Grant {
        kind: GranteeKind::Team,
        id: TEAM.0.to_string(),
        permission: Permission::Edit,
    }
}

fn agent_grant(permission: Permission) -> Grant {
    Grant {
        kind: GranteeKind::Agent,
        id: AGENT.into(),
        permission,
    }
}

fn disclose_password() -> Result<DiscloseRequest, AgentError> {
    serde_json::from_value(serde_json::json!({
        "selector": {"kind": "login", "field": "password"},
        "purpose": "copy",
    }))
    .map_err(|_| AgentError::Invalid)
}

#[tokio::test]
async fn flags_off_is_not_found_before_directory_provider_or_catalog() {
    let vault = vault();
    vault.availability.enabled.store(false, Ordering::SeqCst);
    vault.availability.configured.store(false, Ordering::SeqCst);
    let result = vault
        .service
        .disclose(call(), ItemId(Uuid::from_u128(1)), Err(AgentError::Invalid))
        .await;
    assert!(matches!(result, Err(AgentError::NotFound)));
    assert_eq!(vault.directory.calls.load(Ordering::SeqCst), 0);
    assert_eq!(vault.agents.calls.load(Ordering::SeqCst), 0);
    assert_eq!(vault.items.calls.load(Ordering::SeqCst), 0);
    assert_eq!(vault.provider.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn no_agents_is_invalid_agent_even_without_a_provider() {
    let vault = vault();
    *vault.directory.agent.lock().unwrap() = None;
    vault.availability.configured.store(false, Ordering::SeqCst);
    let result = vault
        .service
        .search(call(), SearchQuery::parse(None, None, None))
        .await;
    assert!(matches!(result, Err(AgentError::InvalidAgent)));
    assert_eq!(vault.agents.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn directory_admits_only_an_enabled_live_agent_of_the_path_team() {
    for (enabled, live, team) in [
        (false, true, TEAM),
        (true, false, TEAM),
        (true, true, TeamId(Uuid::from_u128(0x99))),
    ] {
        let vault = vault();
        *vault.directory.agent.lock().unwrap() = Some(DirectoryAgent {
            agent_user_id: user(AGENT),
            team_id: team,
            owner_user_id: user(HUMAN),
            enabled,
            computer_live: live,
        });
        let result = vault
            .service
            .my_request(call(), ItemId(Uuid::from_u128(1)))
            .await;
        assert!(matches!(result, Err(AgentError::InvalidAgent)));
    }
}

#[tokio::test]
async fn wake_must_be_a_recent_uuid_v7() {
    let vault = vault();
    let old = Uuid::new_v7(uuid::Timestamp::from_unix(
        uuid::NoContext,
        u64::try_from((Utc::now() - TimeDelta::hours(25)).timestamp()).unwrap(),
        0,
    ));
    for wake in [
        None,
        Some(Uuid::from_u128(5).to_string()),
        Some(old.to_string()),
    ] {
        let result = vault
            .service
            .my_request(AgentCall { wake, ..call() }, ItemId(Uuid::from_u128(1)))
            .await;
        assert!(matches!(result, Err(AgentError::InvalidSessionAttribution)));
    }
}

#[tokio::test]
async fn admitted_without_provider_configuration_touches_no_catalog() {
    let vault = vault();
    vault.availability.configured.store(false, Ordering::SeqCst);
    let result = vault
        .service
        .request_access(call(), ItemId(Uuid::from_u128(1)), Err(AgentError::Invalid))
        .await;
    assert!(matches!(result, Err(AgentError::Unavailable)));
    assert_eq!(vault.agents.calls.load(Ordering::SeqCst), 0);
    assert_eq!(vault.items.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn created_item_is_usable_at_once_and_revoking_the_creator_grant_is_not_granted() {
    let vault = vault();
    let created = vault
        .service
        .create(
            call(),
            serde_json::from_value(serde_json::json!({
                "operationId": Uuid::now_v7(),
                "name": "Example",
                "secret": {"kind": "login", "password": "hunter2"},
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await
        .unwrap();
    let Written::Created(created) = created else {
        panic!("expected a new item");
    };
    assert_eq!(created.item.access.use_basis, Some(UseBasis::CreatorGrant));
    assert!(matches!(created.item.kind, ItemKind::Login));
    let item = created.item.id;
    let disclosed = vault
        .service
        .disclose(call(), item, disclose_password())
        .await
        .unwrap();
    assert_eq!(disclosed.value.0, "hunter2");
    let username = vault
        .service
        .disclose(
            call(),
            item,
            serde_json::from_value(serde_json::json!({
                "selector": {"kind": "login", "field": "username"},
                "purpose": "copy",
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await;
    assert!(matches!(username, Err(AgentError::FieldNotSet)));

    // A pending request does not turn a revoked creator into `pending`.
    let admin = Actor {
        user_id: user(ADMIN),
    };
    vault
        .service
        .revoke(
            &admin,
            TEAM,
            item,
            Ok(user(AGENT)),
            Ok(RevokeBody {
                expected_permission_revision: 0,
                scope: RevokeScope::GrantAndApproval,
            }),
        )
        .await
        .unwrap();
    let requested = vault
        .service
        .request_access(
            call(),
            item,
            Ok(AccessRequestBody {
                permission: Permission::View,
            }),
        )
        .await
        .unwrap();
    assert!(matches!(requested, Requested::Pending(_)));
    let result = vault
        .service
        .disclose(call(), item, disclose_password())
        .await;
    assert!(matches!(result, Err(AgentError::NotGranted)));
}

#[tokio::test]
async fn human_and_team_grants_never_confer_agent_use() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        HUMAN,
        ItemKind::Login,
        vec![
            team_edit(),
            Grant {
                kind: GranteeKind::User,
                id: AGENT.into(),
                permission: Permission::Edit,
            },
        ],
        values("user", "secret"),
    );
    let result = vault
        .service
        .disclose(call(), item, disclose_password())
        .await;
    assert!(matches!(result, Err(AgentError::NotGranted)));
    assert_eq!(vault.provider.reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn private_human_items_are_outside_the_agent_catalog() {
    let vault = vault();
    let private = insert(&vault, 1, HUMAN, ItemKind::Login, vec![], values("u", "p"));
    insert(
        &vault,
        2,
        HUMAN,
        ItemKind::Card,
        vec![team_edit()],
        values("u", "p"),
    );
    let page = vault
        .service
        .search(call(), SearchQuery::parse(None, None, None))
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, ItemId(Uuid::from_u128(2)));
    assert_eq!(page.items[0].access.status, AccessStatus::RequestAccess);
    assert_eq!(vault.agents.audits.lock().unwrap().len(), 1);
    let result = vault.service.my_request(call(), private).await;
    assert!(matches!(result, Err(AgentError::NotFound)));
}

#[tokio::test]
async fn shared_grant_needs_standing_approval_and_approval_grants_it() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        HUMAN,
        ItemKind::Api,
        vec![team_edit(), agent_grant(Permission::View)],
        values("key-1", "secret-1"),
    );
    let result = vault
        .service
        .disclose(call(), item, disclose_password())
        .await;
    assert!(matches!(result, Err(AgentError::Pending)));

    let Requested::Pending(state) = vault
        .service
        .request_access(
            call(),
            item,
            Ok(AccessRequestBody {
                permission: Permission::View,
            }),
        )
        .await
        .unwrap()
    else {
        panic!("expected a pending request");
    };
    let reviewers = vault.agents.events.lock().unwrap()[0].reviewers.clone();
    assert!(reviewers.iter().any(|reviewer| reviewer.as_ref() == HUMAN));
    assert!(reviewers.iter().any(|reviewer| reviewer.as_ref() == ADMIN));
    assert!(!reviewers.iter().any(|reviewer| reviewer.as_ref() == AGENT));

    let human = Actor {
        user_id: user(HUMAN),
    };
    let resolved = vault
        .service
        .resolve(
            &human,
            TEAM,
            item,
            state.request_id.unwrap(),
            Ok(ResolveRequest::Approve {
                revision: state.revision,
                permission: Permission::Edit,
            }),
        )
        .await
        .unwrap();
    assert_eq!(resolved.status, RequestStatus::Approved);
    assert_eq!(resolved.access.use_basis, Some(UseBasis::ApprovedGrant));
    assert!(resolved.access.can_update);
    assert!(!resolved.access.can_set_totp);

    // The selector must match the stored kind; the API secret is the password slot.
    let login = vault
        .service
        .disclose(call(), item, disclose_password())
        .await;
    assert!(matches!(login, Err(AgentError::Invalid)));
    let secret = vault
        .service
        .disclose(
            call(),
            item,
            serde_json::from_value(serde_json::json!({
                "selector": {"kind": "api", "field": "secret"},
                "purpose": "copy",
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await
        .unwrap();
    assert_eq!(secret.value.0, "secret-1");
    let key = vault
        .service
        .disclose(
            call(),
            item,
            serde_json::from_value(serde_json::json!({
                "selector": {"kind": "api", "field": "key"},
                "purpose": "copy",
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await
        .unwrap();
    assert_eq!(key.value.0, "key-1");

    // Delivery sends the reviewer notification and the agent's resolution hint.
    assert_eq!(vault.service.deliver_access_events().await.unwrap(), 2);
    let delivered = vault.sink.delivered.lock().unwrap();
    assert_eq!(delivered[1].status, StoredRequestStatus::Approved);
    assert_eq!(delivered[1].agent.as_ref(), AGENT);
}

#[tokio::test]
async fn unsupported_kinds_are_requestable_but_never_disclosed_or_updated() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        HUMAN,
        ItemKind::Card,
        vec![team_edit(), agent_grant(Permission::Edit)],
        values("4111", "123"),
    );
    // Policy errors precede kind errors.
    let pending = vault
        .service
        .disclose(call(), item, disclose_password())
        .await;
    assert!(matches!(pending, Err(AgentError::Pending)));
    vault.agents.rows.lock().unwrap().insert(
        (item.0, AGENT.into()),
        AgentAccessRow {
            approved: true,
            permission_revision: 1,
            request: None,
        },
    );
    let disclosed = vault
        .service
        .disclose(call(), item, disclose_password())
        .await;
    assert!(matches!(disclosed, Err(AgentError::UnsupportedKind)));
    let updated = vault
        .service
        .update(
            call(),
            item,
            serde_json::from_value(serde_json::json!({
                "operationId": Uuid::now_v7(),
                "expectedVersion": 1,
                "metadataPatch": {"name": "Renamed"},
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await;
    assert!(matches!(updated, Err(AgentError::UnsupportedKind)));
    assert_eq!(vault.provider.reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn update_replaces_one_slot_and_preserves_everything_else() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        AGENT,
        ItemKind::Login,
        vec![team_edit(), agent_grant(Permission::Edit)],
        values("ünïcode user", "old"),
    );
    let operation = Uuid::now_v7();
    let patch = || {
        serde_json::from_value::<AgentPatchItem>(serde_json::json!({
            "operationId": operation,
            "expectedVersion": 1,
            "secretPatch": {"kind": "login", "password": "new"},
        }))
        .map_err(|_| AgentError::Invalid)
    };
    let updated = vault.service.update(call(), item, patch()).await.unwrap();
    assert_eq!(updated.version, 2);
    {
        let stored = vault.provider.stored.lock().unwrap();
        let (version, _, values) = stored.get(&item.0).unwrap();
        assert_eq!(*version, 2);
        assert_eq!(values.username.0, "ünïcode user");
        assert_eq!(values.password.0, "new");
        assert_eq!(values.notes.0, "notes ✓");
        let fields: Vec<_> = values
            .fields
            .iter()
            .map(|field| (field.label.as_str(), field.value.0.as_str()))
            .collect();
        assert_eq!(fields, [("PIN", "1"), ("PIN", "2")]);
    }

    // The same operation replays its result instead of writing again.
    let replayed = vault.service.update(call(), item, patch()).await.unwrap();
    assert_eq!(replayed.version, 2);
    assert_eq!(
        vault
            .provider
            .stored
            .lock()
            .unwrap()
            .get(&item.0)
            .unwrap()
            .0,
        2
    );

    // A different operation at a stale version writes nothing.
    let stale = vault
        .service
        .update(
            call(),
            item,
            serde_json::from_value(serde_json::json!({
                "operationId": Uuid::now_v7(),
                "expectedVersion": 1,
                "metadataPatch": {"url": null},
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await;
    assert!(matches!(stale, Err(AgentError::Conflict)));
    assert_eq!(
        vault
            .provider
            .stored
            .lock()
            .unwrap()
            .get(&item.0)
            .unwrap()
            .0,
        2
    );
}

#[tokio::test]
async fn closed_wire_shapes_reject_unknown_fields_and_type_purpose() {
    for body in [
        serde_json::json!({"selector": {"kind": "login", "field": "notes"}, "purpose": "copy"}),
        serde_json::json!({"selector": {"kind": "login", "field": "password"}, "purpose": "type"}),
        serde_json::json!({"selector": {"kind": "card", "field": "number"}, "purpose": "copy"}),
        serde_json::json!({"selector": {"kind": "login", "field": "password", "label": "PIN"}, "purpose": "copy"}),
    ] {
        assert!(serde_json::from_value::<DiscloseRequest>(body).is_err());
    }
    for body in [
        serde_json::json!({"operationId": Uuid::now_v7(), "name": "x", "kind": "login", "secret": {"kind": "login", "password": "p"}}),
        serde_json::json!({"operationId": Uuid::now_v7(), "name": "x", "folderId": null, "secret": {"kind": "login", "password": "p"}}),
        serde_json::json!({"operationId": Uuid::now_v7(), "name": "x", "secret": {"kind": "note", "password": "p"}}),
    ] {
        assert!(serde_json::from_value::<AgentCreateItem>(body).is_err());
    }
}

#[tokio::test]
async fn human_sharing_keeps_agent_grants_and_never_shows_them() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        HUMAN,
        ItemKind::Login,
        vec![team_edit(), agent_grant(Permission::View)],
        values("u", "p"),
    );
    let human = Actor {
        user_id: user(HUMAN),
    };
    let grants = vault
        .service
        .vault
        .grants(&human, TEAM, item)
        .await
        .unwrap();
    assert!(
        grants
            .iter()
            .all(|grant| !matches!(grant.kind, GranteeKind::Agent))
    );
    let shared = vault
        .service
        .vault
        .share(&human, TEAM, item, vec![agent_grant(Permission::Edit)])
        .await;
    assert!(matches!(shared, Err(Error::Invalid)));
    vault
        .service
        .vault
        .share(&human, TEAM, item, vec![])
        .await
        .unwrap();
    let record = vault
        .items
        .records
        .lock()
        .unwrap()
        .get(&item.0)
        .unwrap()
        .clone();
    assert_eq!(record.grants.len(), 1);
    assert!(matches!(record.grants[0].kind, GranteeKind::Agent));
    let view = vault.service.vault.get(&human, TEAM, item).await.unwrap();
    assert_eq!(view.share_count, 0);
    assert!(!view.shared);
}

#[tokio::test]
async fn request_bounds_dedupe_and_deny_cooldown() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        HUMAN,
        ItemKind::Login,
        vec![team_edit()],
        values("u", "p"),
    );
    let body = || {
        Ok(AccessRequestBody {
            permission: Permission::View,
        })
    };
    let Requested::Pending(first) = vault
        .service
        .request_access(call(), item, body())
        .await
        .unwrap()
    else {
        panic!("expected pending");
    };
    let Requested::Pending(again) = vault
        .service
        .request_access(call(), item, body())
        .await
        .unwrap()
    else {
        panic!("expected pending");
    };
    assert_eq!(first.request_id, again.request_id);
    assert_eq!(vault.agents.events.lock().unwrap().len(), 1);

    let admin = Actor {
        user_id: user(ADMIN),
    };
    vault
        .service
        .resolve(
            &admin,
            TEAM,
            item,
            first.request_id.unwrap(),
            Ok(ResolveRequest::Deny {
                revision: first.revision,
            }),
        )
        .await
        .unwrap();
    let cooling = vault.service.request_access(call(), item, body()).await;
    let Err(AgentError::RateLimited { retry_after_ms }) = cooling else {
        panic!("expected a cooldown");
    };
    assert!(retry_after_ms > 3_500_000 && retry_after_ms <= 3_600_001);
}

#[tokio::test]
async fn non_managers_cannot_review_and_see_no_requests() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        ADMIN,
        ItemKind::Login,
        vec![team_edit()],
        values("u", "p"),
    );
    let Requested::Pending(state) = vault
        .service
        .request_access(
            call(),
            item,
            Ok(AccessRequestBody {
                permission: Permission::View,
            }),
        )
        .await
        .unwrap()
    else {
        panic!("expected pending");
    };
    let teammate = Actor {
        user_id: user(HUMAN),
    };
    let page = vault
        .service
        .pending_requests(
            &teammate,
            TEAM,
            service::review::ReviewQuery::parse(None, None, None),
        )
        .await
        .unwrap();
    assert!(page.requests.is_empty());
    let resolved = vault
        .service
        .resolve(
            &teammate,
            TEAM,
            item,
            state.request_id.unwrap(),
            Ok(ResolveRequest::Approve {
                revision: state.revision,
                permission: Permission::View,
            }),
        )
        .await;
    assert!(matches!(resolved, Err(AgentError::Forbidden)));
    let reviewers = vault.agents.events.lock().unwrap()[0].reviewers.clone();
    assert!(!reviewers.iter().any(|reviewer| reviewer.as_ref() == HUMAN));
}

#[tokio::test]
async fn totp_code_refreshes_once_for_an_ambiguous_window() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        AGENT,
        ItemKind::Login,
        vec![team_edit(), agent_grant(Permission::Edit)],
        values("u", "p"),
    );
    let key = TotpKeyId(Uuid::now_v7());
    vault
        .items
        .records
        .lock()
        .unwrap()
        .get_mut(&item.0)
        .unwrap()
        .totp_key_id = Some(key);
    vault
        .provider
        .totp_seeds
        .lock()
        .unwrap()
        .insert(key.0, SecretString("JBSWY3DP".into()));
    // Wake validation reads the clock first; then attempt one brackets 88.5..88.6
    // (ambiguous), attempt two brackets 100..100.2 and finishes at 101.25.
    let wake_check = Utc::now();
    let at = |milliseconds: i64| DateTime::from_timestamp_millis(milliseconds).unwrap();
    let samples = Arc::new(Mutex::new(vec![
        wake_check,
        at(88_500),
        at(88_600),
        at(100_000),
        at(100_200),
        at(101_250),
    ]));
    let clock_samples = samples.clone();
    let mut service = vault.service;
    service.clock = Arc::new(move || clock_samples.lock().unwrap().remove(0));
    let code = service
        .totp_code(
            AgentCall {
                wake: Some(Uuid::now_v7().to_string()),
                ..call()
            },
            item,
            Ok(TotpCodeRequest {
                purpose: AgentPurpose::Copy,
            }),
        )
        .await
        .unwrap();
    assert_eq!(code.expires_at, at(118_000));
    assert_eq!(code.valid_for_ms, 16_750);
    assert_eq!(code.period_seconds, 30);
    assert!(samples.lock().unwrap().is_empty());
}

fn set_totp_body(operation: Uuid) -> Result<AgentSetTotp, AgentError> {
    Ok(AgentSetTotp {
        operation_id: operation,
        expected_version: 1,
        seed: SecretString("JBSWY3DPEHPK3PXP".into()),
    })
}

fn creator_login(vault: &Vault, id: u128) -> ItemId {
    insert(
        vault,
        id,
        AGENT,
        ItemKind::Login,
        vec![team_edit(), agent_grant(Permission::Edit)],
        values("u", "p"),
    )
}

#[tokio::test]
async fn totp_operation_cannot_alias_another_items_or_a_retired_enrollment() {
    let vault = vault();
    let other = creator_login(&vault, 1);
    let mine = creator_login(&vault, 2);
    let key = Uuid::now_v7();
    vault
        .service
        .set_totp(call(), other, set_totp_body(key))
        .await
        .unwrap();
    let seeded = vault.provider.calls.load(Ordering::SeqCst);

    // The same operation on another item would overwrite the first item's seed.
    let aliased = vault
        .service
        .set_totp(call(), mine, set_totp_body(key))
        .await;
    assert!(matches!(aliased, Err(AgentError::Conflict)));
    assert_eq!(vault.provider.calls.load(Ordering::SeqCst), seeded);

    let retired = Uuid::now_v7();
    vault
        .agents
        .stage_totp(
            TEAM,
            mine,
            TotpKeyId(retired),
            &ports::IntentAgent {
                agent: user(AGENT),
                wake: WakeId(Uuid::now_v7()),
                action: AgentAction::AgentTotpSetup,
            },
        )
        .await
        .unwrap();
    vault.agents.retired.lock().unwrap().push(retired);
    let reused = vault
        .service
        .set_totp(call(), mine, set_totp_body(retired))
        .await;
    assert!(matches!(reused, Err(AgentError::Conflict)));
    assert_eq!(vault.provider.calls.load(Ordering::SeqCst), seeded);
}

#[tokio::test]
async fn totp_replay_of_the_active_generation_audits_without_reseeding() {
    let vault = vault();
    let item = creator_login(&vault, 1);
    let key = Uuid::now_v7();
    vault
        .service
        .set_totp(call(), item, set_totp_body(key))
        .await
        .unwrap();
    vault.agents.audits.lock().unwrap().clear();
    let seeded = vault.provider.calls.load(Ordering::SeqCst);
    vault
        .service
        .set_totp(call(), item, set_totp_body(key))
        .await
        .unwrap();
    assert_eq!(vault.provider.calls.load(Ordering::SeqCst), seeded);
    let audits = vault.agents.audits.lock().unwrap();
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].action, AgentAction::AgentTotpSetup);
    assert_eq!(audits[0].event_id, key);
}

#[tokio::test]
async fn a_create_operation_id_is_not_reusable_for_totp_setup() {
    let vault = vault();
    let operation = Uuid::now_v7();
    let Written::Created(created) = vault
        .service
        .create(
            call(),
            serde_json::from_value(serde_json::json!({
                "operationId": operation,
                "name": "Example",
                "secret": {"kind": "login", "password": "hunter2"},
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await
        .unwrap()
    else {
        panic!("expected a new item");
    };
    let before = vault.provider.calls.load(Ordering::SeqCst);
    let enrollments = vault.items.enrollments.lock().unwrap().len();
    let reused = vault
        .service
        .set_totp(call(), created.item.id, set_totp_body(operation))
        .await;
    assert!(matches!(reused, Err(AgentError::Conflict)));
    assert_eq!(vault.provider.calls.load(Ordering::SeqCst), before);
    assert_eq!(vault.items.enrollments.lock().unwrap().len(), enrollments);
}

#[tokio::test]
async fn an_interrupted_agent_write_completes_with_its_intent_under_a_human_reconcile() {
    let vault = vault();
    let item = creator_login(&vault, 1);
    let operation = Uuid::now_v7();
    // The agent's attempt stopped after the provider accepted its write.
    let mut record = vault
        .items
        .records
        .lock()
        .unwrap()
        .get(&item.0)
        .unwrap()
        .clone();
    record.metadata.version = 2;
    vault
        .agents
        .stage(
            operation,
            &record,
            &ports::IntentAgent {
                agent: user(AGENT),
                wake: WakeId(Uuid::now_v7()),
                action: AgentAction::AgentUpdate,
            },
        )
        .await
        .unwrap();
    vault
        .provider
        .write(TEAM, item, 1, operation, &values("u", "new"))
        .await
        .unwrap();
    // A human disclosure reconciles it; the intent's audit completes with it.
    let human = Actor {
        user_id: user(HUMAN),
    };
    vault
        .service
        .vault
        .reveal(&human, TEAM, item, None, false)
        .await
        .unwrap();
    assert_eq!(*vault.items.reconciled.lock().unwrap(), vec![operation]);
    assert_eq!(
        vault
            .items
            .records
            .lock()
            .unwrap()
            .get(&item.0)
            .unwrap()
            .metadata
            .version,
        2
    );
}

#[tokio::test]
async fn an_update_whose_authority_ends_during_the_read_writes_nothing() {
    let vault = vault();
    let item = creator_login(&vault, 1);
    // Admission is the first directory lookup; the post-read recheck the next.
    *vault.directory.revoke_after.lock().unwrap() = Some(1);
    let result = vault
        .service
        .update(
            call(),
            item,
            serde_json::from_value(serde_json::json!({
                "operationId": Uuid::now_v7(),
                "expectedVersion": 1,
                "secretPatch": {"kind": "login", "password": "new"},
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await;
    assert!(matches!(result, Err(AgentError::InvalidAgent)));
    assert_eq!(
        vault
            .provider
            .stored
            .lock()
            .unwrap()
            .get(&item.0)
            .unwrap()
            .0,
        1
    );
    assert!(vault.items.staged.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failing_event_is_deferred_and_does_not_block_later_events() {
    let vault = vault();
    let first = insert(
        &vault,
        1,
        HUMAN,
        ItemKind::Login,
        vec![team_edit()],
        values("u", "p"),
    );
    let second = insert(
        &vault,
        2,
        HUMAN,
        ItemKind::Login,
        vec![team_edit()],
        values("u", "p"),
    );
    for item in [first, second] {
        vault
            .service
            .request_access(
                call(),
                item,
                Ok(AccessRequestBody {
                    permission: Permission::View,
                }),
            )
            .await
            .unwrap();
    }
    let failing = vault.agents.events.lock().unwrap()[0].id;
    vault.sink.failing.lock().unwrap().push(failing);
    assert_eq!(vault.service.deliver_access_events().await.unwrap(), 1);
    assert_eq!(*vault.agents.deferred.lock().unwrap(), vec![failing]);
    assert_eq!(vault.sink.delivered.lock().unwrap()[0].item, second);
}

#[tokio::test]
async fn reviewer_notifications_keep_the_name_from_request_time() {
    let vault = vault();
    let item = insert(
        &vault,
        1,
        HUMAN,
        ItemKind::Login,
        vec![team_edit()],
        values("u", "p"),
    );
    vault
        .service
        .request_access(
            call(),
            item,
            Ok(AccessRequestBody {
                permission: Permission::View,
            }),
        )
        .await
        .unwrap();
    vault
        .items
        .records
        .lock()
        .unwrap()
        .get_mut(&item.0)
        .unwrap()
        .metadata
        .name = "Renamed privately".into();
    vault.service.deliver_access_events().await.unwrap();
    assert_eq!(vault.sink.delivered.lock().unwrap()[0].item_name, "Item");
}

#[tokio::test]
async fn item_review_lists_a_creator_grant_without_a_request() {
    let vault = vault();
    let item = creator_login(&vault, 1);
    let admin = Actor {
        user_id: user(ADMIN),
    };
    let page = vault
        .service
        .pending_requests(
            &admin,
            TEAM,
            service::review::ReviewQuery::parse(Some(item.0.to_string()), None, None),
        )
        .await
        .unwrap();
    assert_eq!(page.requests.len(), 1);
    let state = &page.requests[0];
    assert_eq!(state.agent_account_id.as_ref(), AGENT);
    assert_eq!(state.status, RequestStatus::None);
    assert_eq!(state.revision, 0);
    assert_eq!(state.access.use_basis, Some(UseBasis::CreatorGrant));
    assert_eq!(state.access.permission_revision, 0);
    let teammate = Actor {
        user_id: user(HUMAN),
    };
    let denied = vault
        .service
        .pending_requests(
            &teammate,
            TEAM,
            service::review::ReviewQuery::parse(Some(item.0.to_string()), None, None),
        )
        .await;
    assert!(matches!(denied, Err(AgentError::Forbidden)));
}

#[tokio::test]
async fn a_totp_operation_id_is_not_reusable_for_an_update() {
    let vault = vault();
    let item = creator_login(&vault, 1);
    let operation = Uuid::now_v7();
    vault
        .service
        .set_totp(call(), item, set_totp_body(operation))
        .await
        .unwrap();
    let reused = vault
        .service
        .update(
            call(),
            item,
            serde_json::from_value(serde_json::json!({
                "operationId": operation,
                "expectedVersion": 1,
                "secretPatch": {"kind": "login", "password": "new"},
            }))
            .map_err(|_| AgentError::Invalid),
        )
        .await;
    assert!(matches!(reused, Err(AgentError::Conflict)));
    assert_eq!(
        vault
            .provider
            .stored
            .lock()
            .unwrap()
            .get(&item.0)
            .unwrap()
            .0,
        1
    );
    assert!(vault.items.staged.lock().unwrap().is_empty());
}

#[tokio::test]
async fn staging_rejects_a_key_owned_by_another_item_even_without_the_precheck() {
    let vault = vault();
    let other = creator_login(&vault, 1);
    let mine = creator_login(&vault, 2);
    let key = TotpKeyId(Uuid::now_v7());
    let publisher = ports::IntentAgent {
        agent: user(AGENT),
        wake: WakeId(Uuid::now_v7()),
        action: AgentAction::AgentTotpSetup,
    };
    vault
        .agents
        .stage_totp(TEAM, other, key, &publisher)
        .await
        .unwrap();
    // A stale caller whose precheck saw the key unused must not proceed.
    let stale = vault.agents.stage_totp(TEAM, mine, key, &publisher).await;
    assert!(matches!(stale, Err(Error::Conflict)));
    // The same agent resuming its own pending setup with a new wake proceeds.
    let resumed = ports::IntentAgent {
        wake: WakeId(Uuid::now_v7()),
        ..publisher
    };
    vault
        .agents
        .stage_totp(TEAM, other, key, &resumed)
        .await
        .unwrap();
}
