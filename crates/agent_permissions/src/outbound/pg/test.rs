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
    async fn apply(
        &self,
        owner: &PolicyOwner,
        changes: &[Change],
        by: &MacroUserIdStr<'static>,
        set_by: SetBy,
    ) -> Result<(), PgPermissionStoreError> {
        let write = Write {
            owner,
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
        let write = Write {
            owner: &PolicyOwner::Agent(AGENT),
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
    let owner = PolicyOwner::Agent(AGENT);

    store
        .apply(
            &owner,
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
            &owner,
            &[group_action(Some(PermissionState::Ask))],
            &user(OWNER),
            SetBy::Agent,
        )
        .await
        .unwrap();
    assert_eq!(
        states(&store.rules(&owner).await.unwrap()),
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
        .apply(&owner, &[tool(None)], &user(OWNER), SetBy::Person)
        .await
        .unwrap();
    assert_eq!(store.rules(&owner).await.unwrap().len(), 1);

    store.reset(&owner).await.unwrap();
    assert!(store.rules(&owner).await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn a_personas_rules_are_each_persons_own(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let mine = PolicyOwner::Persona {
        persona: MACRO_NEW_BOT_ID,
        user: user(OWNER),
    };
    let theirs = PolicyOwner::Persona {
        persona: MACRO_NEW_BOT_ID,
        user: user(OTHER),
    };

    store
        .apply(
            &mine,
            &[tool(Some(PermissionState::Never))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    assert_eq!(store.rules(&mine).await.unwrap().len(), 1);
    assert!(store.rules(&theirs).await.unwrap().is_empty());

    store.reset(&mine).await.unwrap();
    assert!(store.rules(&mine).await.unwrap().is_empty());
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
    let always_group_action = sqlx::query!(
        "INSERT INTO agent_tool_permission (bot_id, kind, target, state)
         VALUES ($1, 'group_action', 'email:send', 'always')",
        AGENT.as_uuid(),
    )
    .execute(&pool)
    .await;
    assert!(always_group_action.is_err());

    for (kind, target) in [
        ("group_action", "email:delete"),
        ("group_action", "storage.delete_document"),
        ("tool", "email:send"),
        ("tool", "storage delete"),
    ] {
        let inserted = sqlx::query!(
            "INSERT INTO agent_tool_permission (bot_id, kind, target, state)
             VALUES ($1, $2, $3, 'never')",
            AGENT.as_uuid(),
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
    // The agent's label always comes with the restriction-only rule.
    let labelled_unrestricted = sqlx::query!(
        "INSERT INTO agent_tool_permission (bot_id, kind, target, state, via_agent, restriction_only)
         VALUES ($1, 'tool', 'email.send_email', 'ask', true, false)",
        AGENT.as_uuid(),
    )
    .execute(&pool)
    .await;
    assert!(labelled_unrestricted.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn rows_go_with_their_agent_person_and_session(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let agent = PolicyOwner::Agent(AGENT);
    let persona = PolicyOwner::Persona {
        persona: MACRO_NEW_BOT_ID,
        user: user(OTHER),
    };
    let session = AgentSessionId::new_from_uuid(SESSION);
    let never = [tool(Some(PermissionState::Never))];
    store
        .apply(&agent, &never, &user(OTHER), SetBy::Person)
        .await
        .unwrap();
    store
        .apply(&persona, &never, &user(OTHER), SetBy::Person)
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
    assert_eq!(store.rules(&agent).await.unwrap().len(), 1);
    assert!(store.rules(&persona).await.unwrap().is_empty());
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
    assert!(store.rules(&agent).await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("permissions"))
)]
async fn a_write_reads_both_layers_and_a_refused_plan_writes_nothing(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let owner = PolicyOwner::Agent(AGENT);
    let session = AgentSessionId::new_from_uuid(SESSION);
    store
        .apply(
            &owner,
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
        owner: &owner,
        session: Some(session),
        to: WriteTo::Saved,
        by: &user(OWNER),
        set_by: SetBy::Agent,
    };
    let refused = store
        .write(write, |saved, overlay| {
            assert_eq!((saved.len(), overlay.len()), (1, 1));
            Err(PermissionError::Forbidden)
        })
        .await
        .unwrap();

    assert!(matches!(refused, Err(PermissionError::Forbidden)));
    assert_eq!(store.rules(&owner).await.unwrap().len(), 1);
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
    let owner = PolicyOwner::Agent(AGENT);
    let session = AgentSessionId::new_from_uuid(SESSION);
    store
        .apply_session(session, &[tool(Some(PermissionState::Never))], &user(OTHER))
        .await
        .unwrap();

    let mut gate = pool.begin_with(SNAPSHOT).await.unwrap();
    assert!(policy_rules(&mut gate, &owner).await.unwrap().is_empty());

    store
        .apply(
            &owner,
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

    let (saved, overlay) = store.rules_with_session(&owner, session).await.unwrap();
    assert_eq!(
        states(&saved),
        vec![(
            "static-files.delete_file".to_owned(),
            PermissionState::Never,
            false,
            false
        )]
    );
    assert!(overlay.is_empty());
}
