mod sources;

use agent_permission_registry::Action;
use bot_id::{BotId, MACRO_NEW_BOT_ID};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::Uuid;
use sqlx::PgPool;

use super::*;
use crate::domain::model::{PermissionState, SetBy};
use crate::domain::ports::{Write, WriteTo};

const OWNER: &str = "macro|perm-owner@example.com";
const OTHER: &str = "macro|perm-other@example.com";
const AGENT: BotId = BotId::new_from_uuid(Uuid::from_u128(0x91000000_0000_0000_0000_000000000021));
const SESSION: Uuid = Uuid::from_u128(0x91000000_0000_0000_0000_000000000031);

/// Writes that apply `changes` as given, as the service's plans do once
/// they pass.
impl PgPermissionStore {
    /// A policy's own saved settings; none for no such policy.
    async fn rules(&self, policy: PolicyId) -> Result<Vec<Rule>, PgPermissionStoreError> {
        Ok(self
            .chain(policy)
            .await?
            .map(|chain| chain.rules().to_vec())
            .unwrap_or_default())
    }

    async fn apply(
        &self,
        policy: PolicyId,
        changes: &[Change],
        by: &MacroUserIdStr<'static>,
        set_by: SetBy,
    ) -> Result<(), PgPermissionStoreError> {
        let write = Write {
            policy,
            session: None,
            to: WriteTo::Saved,
            by,
            set_by,
        };
        let planned = self.write(write, |_, _| Ok(changes.to_vec())).await?;
        assert!(planned.is_ok());
        Ok(())
    }

    async fn apply_session(
        &self,
        session: AgentSessionId,
        changes: &[Change],
        by: &MacroUserIdStr<'static>,
    ) -> Result<(), PgPermissionStoreError> {
        let policy = self.ensure_policy(&PolicyOwner::Agent(AGENT)).await?;
        let write = Write {
            policy,
            session: Some(session),
            to: WriteTo::Session(session),
            by,
            set_by: SetBy::Agent,
        };
        let planned = self.write(write, |_, _| Ok(changes.to_vec())).await?;
        assert!(planned.is_ok());
        Ok(())
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

fn group_action(state: Option<PermissionState>) -> Change {
    Change {
        target: Target::GroupAction {
            group: "email".to_owned(),
            action: Action::Send,
        },
        state,
    }
}

fn default(state: Option<PermissionState>) -> Change {
    Change {
        target: Target::Action {
            action: Action::Send,
        },
        state,
    }
}

fn tool(state: Option<PermissionState>) -> Change {
    Change {
        target: Target::Tool {
            service: "static-files".to_owned(),
            operation: "delete_file".to_owned(),
        },
        state,
    }
}

fn states(rules: &[Rule]) -> Vec<(String, PermissionState, bool, bool)> {
    let mut states: Vec<_> = rules
        .iter()
        .map(|rule| {
            (
                rule.target.key(),
                rule.state,
                rule.via_agent,
                rule.restriction_only,
            )
        })
        .collect();
    states.sort();
    states
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn an_agents_rules_upsert_delete_and_reset(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let owner = store
        .ensure_policy(&PolicyOwner::Agent(AGENT))
        .await
        .unwrap();

    store
        .apply(
            owner,
            &[
                group_action(Some(PermissionState::Never)),
                tool(Some(PermissionState::Always)),
            ],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    store
        .apply(
            owner,
            &[group_action(Some(PermissionState::Ask))],
            &user(OWNER),
            SetBy::Agent,
        )
        .await
        .unwrap();
    assert_eq!(
        states(&store.rules(owner).await.unwrap()),
        vec![
            ("email:send".to_owned(), PermissionState::Ask, true, true),
            (
                "static-files.delete_file".to_owned(),
                PermissionState::Always,
                false,
                false
            ),
        ]
    );

    store
        .apply(owner, &[tool(None)], &user(OWNER), SetBy::Person)
        .await
        .unwrap();
    assert_eq!(store.rules(owner).await.unwrap().len(), 1);

    store.reset(owner).await.unwrap();
    assert!(store.rules(owner).await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn a_default_and_an_explicit_allow_exception_round_trip(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let policy = store
        .ensure_policy(&PolicyOwner::Agent(AGENT))
        .await
        .unwrap();
    store
        .apply(
            policy,
            &[
                default(Some(PermissionState::Ask)),
                group_action(Some(PermissionState::Always)),
            ],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    let rules = store.rules(policy).await.unwrap();
    assert_eq!(
        states(&rules),
        vec![
            (
                "email:send".to_owned(),
                PermissionState::Always,
                false,
                false
            ),
            ("send".to_owned(), PermissionState::Ask, false, false),
        ]
    );
    assert!(rules.iter().any(|rule| rule.target
        == Target::Action {
            action: Action::Send
        }));

    store
        .apply(policy, &[default(None)], &user(OWNER), SetBy::Person)
        .await
        .unwrap();
    assert_eq!(
        states(&store.rules(policy).await.unwrap()),
        vec![(
            "email:send".to_owned(),
            PermissionState::Always,
            false,
            false
        )]
    );

    // A session's overlay holds a default too.
    let session = AgentSessionId::new_from_uuid(SESSION);
    store
        .apply_session(
            session,
            &[default(Some(PermissionState::Never))],
            &user(OTHER),
        )
        .await
        .unwrap();
    assert_eq!(
        states(&store.session_rules(session).await.unwrap()),
        vec![("send".to_owned(), PermissionState::Never, true, true)]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn a_personas_rules_are_each_persons_own(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let mine = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OWNER),
        })
        .await
        .unwrap();
    let theirs = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OTHER),
        })
        .await
        .unwrap();
    assert_ne!(mine, theirs);

    store
        .apply(
            mine,
            &[tool(Some(PermissionState::Never))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    assert_eq!(store.rules(mine).await.unwrap().len(), 1);
    assert!(store.rules(theirs).await.unwrap().is_empty());

    store.reset(mine).await.unwrap();
    assert!(store.rules(mine).await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn a_sessions_overlay_upserts_and_deletes(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let session = AgentSessionId::new_from_uuid(SESSION);

    store
        .apply_session(session, &[tool(Some(PermissionState::Ask))], &user(OTHER))
        .await
        .unwrap();
    store
        .apply_session(session, &[tool(Some(PermissionState::Never))], &user(OTHER))
        .await
        .unwrap();
    assert_eq!(
        states(&store.session_rules(session).await.unwrap()),
        vec![(
            "static-files.delete_file".to_owned(),
            PermissionState::Never,
            true,
            true
        )]
    );

    store
        .apply_session(session, &[tool(None)], &user(OTHER))
        .await
        .unwrap();
    assert!(store.session_rules(session).await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn the_tables_refuse_a_stored_default_and_a_bad_target(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let policy = store
        .ensure_policy(&PolicyOwner::Agent(AGENT))
        .await
        .unwrap()
        .as_uuid();
    // An action's default is `always` when no row says otherwise.
    let always_action = sqlx::query!(
        "INSERT INTO agent_permission_rule (policy_id, kind, target, state)
         VALUES ($1, 'action', 'send', 'always')",
        policy,
    )
    .execute(&pool)
    .await;
    assert!(always_action.is_err());

    for (kind, target) in [
        ("action", "email:send"),
        ("action", "delete"),
        ("group_action", "email:delete"),
        ("group_action", "storage.delete_document"),
        ("tool", "email:send"),
        ("tool", "storage delete"),
        ("operation", "email.send_email"),
    ] {
        let inserted = sqlx::query!(
            "INSERT INTO agent_permission_rule (policy_id, kind, target, state)
             VALUES ($1, $2, $3, 'never')",
            policy,
            kind,
            target,
        )
        .execute(&pool)
        .await;
        assert!(inserted.is_err(), "{kind} {target}");
    }

    let always_overlay = sqlx::query!(
        "INSERT INTO agent_session_tool_permission (agent_session_id, kind, target, state)
         VALUES ($1, 'tool', 'email.send_email', 'always')",
        SESSION,
    )
    .execute(&pool)
    .await;
    assert!(always_overlay.is_err());
    // The overlay takes a default, never `always`, and only a real action.
    for (target, state, ok) in [
        ("send", "never", true),
        ("send", "always", false),
        ("delete", "never", false),
        ("email:send", "never", false),
    ] {
        let inserted = sqlx::query!(
            "INSERT INTO agent_session_tool_permission (agent_session_id, kind, target, state)
             VALUES ($1, 'action', $2, $3)",
            SESSION,
            target,
            state,
        )
        .execute(&pool)
        .await;
        assert_eq!(inserted.is_ok(), ok, "{target} {state}");
    }
    // The agent's label always comes with the restriction-only rule.
    let labelled_unrestricted = sqlx::query!(
        "INSERT INTO agent_permission_rule (policy_id, kind, target, state, via_agent, restriction_only)
         VALUES ($1, 'tool', 'email.send_email', 'ask', true, false)",
        policy,
    )
    .execute(&pool)
    .await;
    assert!(labelled_unrestricted.is_err());

    // A policy names exactly one owner, of its kind.
    for (kind, bot, user, persona) in [
        ("agent", None, None, None),
        ("agent", Some(AGENT.as_uuid()), Some(OWNER), None),
        ("persona", None, Some(OWNER), None),
        ("persona", None, None, Some(MACRO_NEW_BOT_ID.as_uuid())),
        ("team", None, None, None),
    ] {
        let inserted = sqlx::query!(
            "INSERT INTO agent_permission_policy (id, kind, bot_id, user_id, persona_id)
             VALUES ($1, $2, $3, $4, $5)",
            PolicyId::generate().as_uuid(),
            kind,
            bot,
            user,
            persona,
        )
        .execute(&pool)
        .await;
        assert!(inserted.is_err(), "{kind} {bot:?} {user:?} {persona:?}");
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn rows_go_with_their_agent_person_and_session(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let agent = store
        .ensure_policy(&PolicyOwner::Agent(AGENT))
        .await
        .unwrap();
    let persona = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OTHER),
        })
        .await
        .unwrap();
    let session = AgentSessionId::new_from_uuid(SESSION);
    let never = [tool(Some(PermissionState::Never))];
    store
        .apply(agent, &never, &user(OTHER), SetBy::Person)
        .await
        .unwrap();
    store
        .apply(persona, &never, &user(OTHER), SetBy::Person)
        .await
        .unwrap();
    store
        .apply_session(session, &never, &user(OTHER))
        .await
        .unwrap();

    // Deleting the person who set the agent's rule keeps it, without them.
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, OTHER)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(store.rules(agent).await.unwrap().len(), 1);
    assert!(store.rules(persona).await.unwrap().is_empty());
    assert_eq!(store.session_rules(session).await.unwrap().len(), 1);

    sqlx::query!("DELETE FROM agent_session WHERE id = $1", SESSION)
        .execute(&pool)
        .await
        .unwrap();
    assert!(store.session_rules(session).await.unwrap().is_empty());

    sqlx::query!("DELETE FROM bots WHERE id = $1", AGENT.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert!(store.rules(agent).await.unwrap().is_empty());
    // The policies went with their agent and person, not only their rules.
    let policies = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM agent_permission_policy WHERE id = ANY($1)",
        &[agent.as_uuid(), persona.as_uuid()],
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(policies, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn a_write_reads_both_layers_and_a_refused_plan_writes_nothing(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let owner = store
        .ensure_policy(&PolicyOwner::Agent(AGENT))
        .await
        .unwrap();
    let session = AgentSessionId::new_from_uuid(SESSION);
    store
        .apply(
            owner,
            &[group_action(Some(PermissionState::Ask))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    store
        .apply_session(session, &[tool(Some(PermissionState::Never))], &user(OTHER))
        .await
        .unwrap();

    let write = Write {
        policy: owner,
        session: Some(session),
        to: WriteTo::Saved,
        by: &user(OWNER),
        set_by: SetBy::Agent,
    };
    let refused = store
        .write(write, |saved, overlay| {
            assert_eq!((saved.rules().len(), overlay.len()), (1, 1));
            Err(PermissionError::Forbidden)
        })
        .await
        .unwrap();

    assert!(matches!(refused, Err(PermissionError::Forbidden)));
    assert_eq!(store.rules(owner).await.unwrap().len(), 1);
}

/// The CodeRabbit interleaving: the gate has read the policy (no setting,
/// so the default Always) when a person saves Never and the agent then drops
/// its own Never from the session. Read at the gate's isolation, the overlay
/// read that follows still sees the agent's Never, so no snapshot resolves
/// the call to Always.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn a_gate_reads_the_policy_and_overlay_as_one_snapshot(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let owner = store
        .ensure_policy(&PolicyOwner::Agent(AGENT))
        .await
        .unwrap();
    let session = AgentSessionId::new_from_uuid(SESSION);
    store
        .apply_session(session, &[tool(Some(PermissionState::Never))], &user(OTHER))
        .await
        .unwrap();

    let mut gate = pool.begin_with(SNAPSHOT).await.unwrap();
    let chain = read_chain(&mut gate, owner).await.unwrap().unwrap();
    assert!(chain.rules().is_empty());

    store
        .apply(
            owner,
            &[tool(Some(PermissionState::Never))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    store
        .apply_session(session, &[tool(None)], &user(OTHER))
        .await
        .unwrap();

    assert_eq!(
        states(&overlay_rules(&mut gate, session).await.unwrap()),
        vec![(
            "static-files.delete_file".to_owned(),
            PermissionState::Never,
            true,
            true
        )]
    );
    gate.commit().await.unwrap();

    let (chain, overlay) = store
        .chain_with_session(owner, session)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        states(chain.rules()),
        vec![(
            "static-files.delete_file".to_owned(),
            PermissionState::Never,
            false,
            false
        )]
    );
    assert!(overlay.is_empty());
}

/// Everything in the migration after this line: the backfill alone.
const BACKFILL_FROM: &str = "-- Backfill";

fn backfill() -> &'static str {
    let migration = include_str!(
        "../../../../macro_db_client/migrations/20261122220100_agent_permission_policies.sql"
    );
    &migration[migration.find(BACKFILL_FROM).expect("the backfill marker")..]
}

/// Rows saved before policies had ids, in the old tables, come through the
/// backfill under one stable v7 id per policy, verbatim (channel_admin rows
/// included), and a second run adds nothing.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn the_backfill_gives_every_policy_a_stable_id_and_copies_its_rows(pool: PgPool) {
    sqlx::query!(
        r#"
        INSERT INTO agent_tool_permission
            (bot_id, kind, target, state, updated_by, via_agent, restriction_only, updated_at)
        VALUES
            ($1, 'group_action', 'channels:send', 'never', $2, false, false, '2026-11-01T00:00:00Z'),
            ($1, 'group_action', 'channel_admin:send', 'never', $2, false, false, '2026-11-01T00:00:00Z'),
            ($1, 'tool', 'email.send_email', 'ask', NULL, true, true, '2026-11-02T00:00:00Z')
        "#,
        AGENT.as_uuid(),
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO persona_tool_permission
            (user_id, persona_id, kind, target, state, via_agent, restriction_only, updated_at)
        VALUES
            ($1, $3, 'tool', 'static-files.delete_file', 'always', false, false, '2026-11-03T00:00:00Z'),
            ($2, $3, 'group_action', 'email:send', 'ask', false, true, '2026-11-04T00:00:00Z')
        "#,
        OWNER,
        OTHER,
        MACRO_NEW_BOT_ID.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::raw_sql(backfill()).execute(&pool).await.unwrap();
    let ids = sqlx::query!(
        r#"
        SELECT id, kind
        FROM agent_permission_policy
        ORDER BY kind, user_id
        "#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    // Again: nothing new, nothing changed.
    sqlx::raw_sql(backfill()).execute(&pool).await.unwrap();

    let store = PgPermissionStore::new(pool.clone());
    let agent = store
        .ensure_policy(&PolicyOwner::Agent(AGENT))
        .await
        .unwrap();
    let mine = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OWNER),
        })
        .await
        .unwrap();
    let theirs = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OTHER),
        })
        .await
        .unwrap();
    assert_eq!(
        ids.iter()
            .map(|row| (
                row.kind.as_str(),
                PolicyId::from_uuid(row.id),
                row.id.get_version_num()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("agent", agent, 7),
            // `perm-other` sorts before `perm-owner`.
            ("persona", theirs, 7),
            ("persona", mine, 7)
        ]
    );
    let policies =
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM agent_permission_policy"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(policies, 3);

    assert_eq!(
        states(&store.rules(agent).await.unwrap()),
        vec![
            (
                "channel_admin:send".to_owned(),
                PermissionState::Never,
                false,
                false
            ),
            (
                "channels:send".to_owned(),
                PermissionState::Never,
                false,
                false
            ),
            (
                "email.send_email".to_owned(),
                PermissionState::Ask,
                true,
                true
            ),
        ]
    );
    assert_eq!(
        states(&store.rules(mine).await.unwrap()),
        vec![(
            "static-files.delete_file".to_owned(),
            PermissionState::Always,
            false,
            false
        )]
    );
    assert_eq!(
        states(&store.rules(theirs).await.unwrap()),
        vec![("email:send".to_owned(), PermissionState::Ask, false, true)]
    );

    // Who made each row and when come along unchanged.
    let copied = sqlx::query!(
        r#"
        SELECT target, updated_by, updated_at::text AS "updated_at!"
        FROM agent_permission_rule
        ORDER BY target COLLATE "C"
        "#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        copied
            .iter()
            .map(|row| (
                row.target.as_str(),
                row.updated_by.as_deref(),
                row.updated_at.as_str()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("channel_admin:send", Some(OWNER), "2026-11-01 00:00:00+00"),
            ("channels:send", Some(OWNER), "2026-11-01 00:00:00+00"),
            ("email.send_email", None, "2026-11-02 00:00:00+00"),
            ("email:send", None, "2026-11-04 00:00:00+00"),
            ("static-files.delete_file", None, "2026-11-03 00:00:00+00"),
        ]
    );
}

/// Callers racing to create one owner's policy all get the one id.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn concurrent_first_uses_of_a_policy_agree_on_its_id(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let owners = [
        PolicyOwner::Agent(AGENT),
        PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OWNER),
        },
    ];
    for owner in owners {
        let calls = (0..8).map(|_| {
            let store = store.clone();
            let owner = owner.clone();
            tokio::spawn(async move { store.ensure_policy(&owner).await.unwrap() })
        });
        let mut ids = Vec::new();
        for call in calls.collect::<Vec<_>>() {
            ids.push(call.await.unwrap());
        }
        ids.dedup();
        assert_eq!(ids.len(), 1, "{owner:?}");
        assert_eq!(store.ensure_policy(&owner).await.unwrap(), ids[0]);
    }
    let policies =
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM agent_permission_policy"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(policies, 2);
}

/// Migration `20261122220000` copies each saved `channels:<action>` rule to
/// `channel_admin:<action>` with its state, flags and author, keeps one
/// already there, and leaves every other row alone. `sqlx::test` has run it
/// on empty tables, so the fixtures are loaded and it is run again.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("permissions", "channel_admin_copy")
    )
)]
async fn the_channel_admin_migration_copies_every_channels_rule(pool: PgPool) {
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261122220000_agent_tool_permission_channel_admin.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let agent = sqlx::query_scalar!(
        r#"SELECT concat_ws(' ', kind, target, state, coalesce(updated_by, '-'), via_agent,
                  restriction_only, extract(epoch FROM updated_at)::bigint) AS "row!"
           FROM agent_tool_permission WHERE bot_id = $1 ORDER BY kind, target"#,
        AGENT.as_uuid(),
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        agent,
        [
            "group_action channel_admin:destroy ask - f f 1767484800",
            "group_action channel_admin:read ask - t t 1767398400",
            "group_action channel_admin:send never macro|perm-owner@example.com f f 1767323045",
            "group_action channels:destroy never - f f 1767571200",
            "group_action channels:read ask - t t 1767398400",
            "group_action channels:send never macro|perm-owner@example.com f f 1767323045",
            "group_action email:send never - f f 1767571200",
            "tool storage.join_channel ask - f f 1767571200",
        ]
    );

    let persona = sqlx::query_scalar!(
        r#"SELECT concat_ws(' ', persona_id, kind, target, state, via_agent, restriction_only,
                  extract(epoch FROM updated_at)::bigint) AS "row!"
           FROM persona_tool_permission WHERE user_id = $1 ORDER BY kind, target"#,
        OWNER,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        persona,
        [
            "91000000-0000-0000-0000-0000000000aa group_action channel_admin:update ask t t 1769904000",
            "91000000-0000-0000-0000-0000000000aa group_action channels:update ask t t 1769904000",
            "91000000-0000-0000-0000-0000000000aa group_action documents:destroy never f f 1769904000",
        ]
    );

    let session = sqlx::query_scalar!(
        r#"SELECT concat_ws(' ', kind, target, state, coalesce(set_by, '-'),
                  extract(epoch FROM created_at)::bigint) AS "row!"
           FROM agent_session_tool_permission WHERE agent_session_id = $1 ORDER BY kind, target"#,
        SESSION,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        session,
        [
            "group_action channel_admin:create never macro|perm-other@example.com 1772323200",
            "group_action channels:create never macro|perm-other@example.com 1772323200",
            "tool storage.delete_channel ask - 1772323200",
        ]
    );
}
