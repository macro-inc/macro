//! Agents on their owners' own machines.

use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngine, ContainerEngineKind, HostArch, HostOs, TeammateHostReport,
};

use super::*;
use crate::domain::self_hosting::{FloorResource, HostIneligibility};

const LAPTOP: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d01));
const DESKTOP: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d02));
const THEIRS: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d03));

fn docker_linux() -> TeammateHostReport {
    TeammateHostReport {
        engine: Some(ContainerEngine {
            kind: ContainerEngineKind::Docker,
            version: "29.0.1".to_owned(),
            rootless: false,
        }),
        engines: Vec::new(),
        os: HostOs::Linux,
        arch: HostArch::Amd64,
        cpus: 8,
        memory_mib: 32 * 1024,
        disk_free_mib: Some(200 * 1024),
        problem: None,
        installs: vec![],
    }
}

fn host(
    harness_id: HarnessId,
    name: &str,
    connected: bool,
    report: Option<TeammateHostReport>,
) -> HostFacts {
    HostFacts {
        harness_id,
        name: name.to_owned(),
        connected,
        report,
    }
}

/// The admin's laptop and desktop, both up, and someone else's machine.
fn self_hosted_service() -> (Service, Journal, Flags) {
    let (service, journal, flags) = service_with_flags(true, FakeComputers::default());
    service.installs.hosts.lock().unwrap().extend([
        (
            user(ADMIN),
            host(LAPTOP, "Laptop", true, Some(docker_linux())),
        ),
        (
            user(ADMIN),
            host(DESKTOP, "Desktop", true, Some(docker_linux())),
        ),
        (
            user("macro|someone@example.com"),
            host(THEIRS, "Theirs", true, Some(docker_linux())),
        ),
    ]);
    (service, journal, flags)
}

fn own(harness_id: HarnessId) -> CreateTeamAgent {
    CreateTeamAgent {
        size: None,
        computer: Some(InviteComputer::Own { harness_id }),
        ..request()
    }
}

fn set_connected(service: &Service, harness: HarnessId, connected: bool) {
    for (_, host) in service.installs.hosts.lock().unwrap().iter_mut() {
        if host.harness_id == harness {
            host.connected = connected;
        }
    }
}

#[tokio::test]
async fn an_own_machine_invite_installs_the_agent_there_and_buys_nothing() {
    let (service, journal, _) = self_hosted_service();

    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();

    assert_eq!(agent.harness_id, Some(LAPTOP));
    assert_eq!(agent.computer_id, None);
    assert_eq!(agent.status, TeamAgentStatus::Provisioning);
    let entries = journal.entries();
    assert_eq!(entries.len(), 5);
    assert!(entries[0].starts_with("account.create sam-rivera-"));
    assert_eq!(entries[1], "team.add");
    assert_eq!(entries[2], "repo.create Sam Rivera");
    assert_eq!(entries[3], format!("install.create on {LAPTOP}"));
    assert_eq!(entries[4], format!("runtimes.changed {LAPTOP}"));
    // A retry of the same invite answers with the same agent.
    let retried = service.create(receipt(), own(LAPTOP)).await.unwrap();
    assert_eq!(retried.user_id, agent.user_id);
    assert_eq!(journal.entries().len(), 5);
}

#[tokio::test]
async fn without_the_self_hosted_rollout_an_own_machine_invite_creates_nothing() {
    let (service, journal, flags) = self_hosted_service();
    flags.set_self_hosted(false);

    let result = service.create(receipt(), own(LAPTOP)).await;

    assert!(matches!(result, Err(TeamAgentError::SelfHostedNotEnabled)));
    assert!(journal.entries().is_empty());
    assert!(matches!(
        service.hosts(receipt()).await,
        Err(TeamAgentError::SelfHostedNotEnabled)
    ));
}

#[tokio::test]
async fn an_ineligible_machine_is_refused_with_its_reason_before_anything_is_created() {
    let (service, journal, _) = self_hosted_service();
    service.installs.hosts.lock().unwrap()[0].1.report = Some(TeammateHostReport {
        cpus: 1,
        ..docker_linux()
    });

    let result = service.create(receipt(), own(LAPTOP)).await;

    let Err(TeamAgentError::HostNotEligible(eligibility)) = result else {
        panic!("expected the machine to be refused, got {result:?}");
    };
    assert_eq!(eligibility.reason, Some(HostIneligibility::BelowFloor));
    assert_eq!(eligibility.resource, Some(FloorResource::Cpus));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn someone_elses_machine_looks_like_no_machine() {
    let (service, journal, _) = self_hosted_service();

    let result = service.create(receipt(), own(THEIRS)).await;

    assert!(matches!(result, Err(TeamAgentError::NotFound)));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn an_invite_naming_both_a_size_and_a_machine_is_refused() {
    let (service, journal, _) = self_hosted_service();

    let result = service
        .create(
            receipt(),
            CreateTeamAgent {
                size: Some(ComputerSize::Standard),
                ..own(LAPTOP)
            },
        )
        .await;

    assert!(matches!(result, Err(TeamAgentError::InvalidComputer)));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn the_hosts_are_the_admins_own_machines_with_their_eligibility() {
    let (service, _, _) = self_hosted_service();
    set_connected(&service, DESKTOP, false);

    let hosts = service.hosts(receipt()).await.unwrap().hosts;

    assert_eq!(hosts.len(), 2);
    assert_eq!(hosts[0].harness_id, LAPTOP);
    assert!(hosts[0].eligibility.ok);
    assert_eq!(hosts[1].harness_id, DESKTOP);
    assert_eq!(
        hosts[1].eligibility.reason,
        Some(HostIneligibility::Offline)
    );
}

#[tokio::test]
async fn an_install_is_issued_fresh_public_credentials_once_per_delivery() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let install = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();

    let issued = service
        .issue_install(LAPTOP, install.install_id, None)
        .await
        .unwrap()
        .expect("a machine running nothing gets the install");

    assert_eq!((issued.generation, issued.delivery), (1, 1));
    let env = issued.env.expose();
    let value = |key: &str| {
        env.iter()
            .find(|(name, _)| name.as_str() == key)
            .map(|(_, value)| value.clone())
    };
    assert_eq!(
        value("MACRO_GATEWAY").as_deref(),
        Some("https://public-gateway.example.com")
    );
    assert_eq!(
        value(env_keys::TEAMMATE_INSTALL_ID),
        Some(install.install_id.to_string())
    );
    assert_eq!(value(env_keys::COMPUTER_ID), None);
    assert!(value(env_keys::API_KEY).is_some());
    assert!(value(env_keys::REPO_TOKEN).is_some());
    let mints = |journal: &Journal| {
        journal
            .entries()
            .iter()
            .filter(|entry| *entry == "api_key.mint")
            .count()
    };
    assert_eq!(mints(&journal), 1);

    // The machine reconnects running that delivery: nothing is minted.
    let again = service
        .issue_install(LAPTOP, install.install_id, Some((1, 1)))
        .await
        .unwrap();
    assert!(again.is_none());
    // Another machine never gets it.
    let elsewhere = service
        .issue_install(DESKTOP, install.install_id, None)
        .await
        .unwrap();
    assert!(elsewhere.is_none());
    assert_eq!(mints(&journal), 1);
    // A send that was lost leaves the machine behind: the next connect
    // delivers again, as the next delivery.
    let resent = service
        .issue_install(LAPTOP, install.install_id, Some((0, 0)))
        .await
        .unwrap()
        .unwrap();
    assert_eq!((resent.generation, resent.delivery), (1, 2));
}

#[tokio::test]
async fn with_the_inviters_self_hosted_rollout_off_nothing_is_issued() {
    let (service, journal, flags) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let install = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    flags.set_self_hosted(false);

    let issued = service
        .issue_install(LAPTOP, install.install_id, None)
        .await
        .unwrap();

    assert!(issued.is_none());
    assert!(!journal.entries().contains(&"api_key.mint".to_owned()));
}

#[tokio::test]
async fn a_move_stops_the_old_machine_first_and_mints_nothing_until_it_stopped() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let old = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    service
        .issue_install(LAPTOP, old.install_id, None)
        .await
        .unwrap();
    let before = journal.entries().len();

    let moving = service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: DESKTOP,
            },
        )
        .await
        .unwrap();

    // The old machine is told; nothing is revoked or minted yet, and
    // nothing is delivered while it checkpoints.
    assert_eq!(moving.harness_id, Some(LAPTOP));
    assert_eq!(
        journal.entries()[before..],
        [
            format!("install.checkpoint Moving {{ to: {DESKTOP:?} }}"),
            format!("runtimes.changed {LAPTOP}"),
        ]
    );
    assert!(
        service
            .issue_install(LAPTOP, old.install_id, None)
            .await
            .unwrap()
            .is_none()
    );

    // The old machine reported the agent stopped.
    service.finish_checkpoint(old.install_id).await.unwrap();

    let moved = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(moved.harness_id, DESKTOP);
    assert_ne!(moved.install_id, old.install_id);
    assert_eq!(moved.generation, 2);
    assert_eq!(
        journal.entries().last().unwrap(),
        &format!("runtimes.changed {DESKTOP}")
    );
    // Finishing again is a no-op.
    service.finish_checkpoint(old.install_id).await.unwrap();
    assert_eq!(service.installs.rows.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_move_off_an_offline_machine_finishes_at_once() {
    let (service, _, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    set_connected(&service, LAPTOP, false);

    service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: DESKTOP,
            },
        )
        .await
        .unwrap();

    let moved = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(moved.harness_id, DESKTOP);
    assert_eq!(moved.checkpoint, None);
}

#[tokio::test]
async fn moving_an_agent_on_a_macro_computer_is_refused() {
    let (service, _, _) = self_hosted_service();
    let agent = service.create(receipt(), request()).await.unwrap();

    let result = service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: DESKTOP,
            },
        )
        .await;

    assert!(matches!(result, Err(TeamAgentError::NotSelfHosted)));
}

#[tokio::test]
async fn removal_waits_for_the_machine_to_stop_the_agent_then_revokes_and_removes_it() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let install = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    let before = journal.entries().len();

    service.delete(receipt(), &agent.user_id).await.unwrap();

    assert_eq!(
        journal.entries()[before..],
        [
            "install.checkpoint Removing".to_owned(),
            format!("runtimes.changed {LAPTOP}"),
        ]
    );
    assert_eq!(service.repository.records().len(), 1);

    service.finish_checkpoint(install.install_id).await.unwrap();

    assert_eq!(
        journal.entries()[before + 2..],
        [
            "api_key.revoke_all".to_owned(),
            "repo.create Sam Rivera".to_owned(),
            format!("team.take_back {TEAM} by {ADMIN}"),
            "seat.remove".to_owned(),
        ]
    );
    assert!(service.repository.records().is_empty());
}

#[tokio::test]
async fn a_failed_or_rolled_back_install_says_why_and_a_running_one_says_nothing() {
    use crate::domain::models::InstallProblem;
    use crate::domain::self_hosting::InstallFailure;
    let (service, _, _) = self_hosted_service();
    service.create(receipt(), own(LAPTOP)).await.unwrap();
    let problem_after = |run_state, failure| {
        service.installs.update(
            |_| true,
            |row| {
                row.run_state = run_state;
                row.failure = failure;
            },
        );
        let service = &service;
        async move {
            let listed = service.list(receipt()).await.unwrap();
            listed.agents[0].install_problem
        }
    };

    assert_eq!(
        problem_after(
            InstallRunState::Failed,
            Some(InstallFailure::IncompatibleRuntime)
        )
        .await,
        Some(InstallProblem::Failed {
            reason: InstallFailure::IncompatibleRuntime
        })
    );
    assert_eq!(
        problem_after(InstallRunState::RolledBack, Some(InstallFailure::CrashLoop)).await,
        Some(InstallProblem::RolledBack {
            reason: InstallFailure::CrashLoop
        })
    );
    assert_eq!(problem_after(InstallRunState::Running, None).await, None);
}

#[test]
fn an_install_problem_reads_camel_case_on_the_api() {
    use crate::domain::models::InstallProblem;
    use crate::domain::self_hosting::InstallFailure;
    assert_eq!(
        serde_json::to_value(InstallProblem::RolledBack {
            reason: InstallFailure::BadConfiguration
        })
        .unwrap(),
        serde_json::json!({"kind": "rolledBack", "reason": "badConfiguration"})
    );
}

#[tokio::test]
async fn listing_reads_every_agents_install_in_one_query() {
    let (service, _, _) = self_hosted_service();
    service.create(receipt(), own(LAPTOP)).await.unwrap();
    service
        .create(
            receipt(),
            CreateTeamAgent {
                purchase_key: "invite-2".to_owned(),
                name: "Ada".to_owned(),
                ..own(DESKTOP)
            },
        )
        .await
        .unwrap();
    let before = service.installs.agent_reads.load(Ordering::SeqCst);

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(listed.agents.len(), 2);
    assert_eq!(
        service.installs.agent_reads.load(Ordering::SeqCst) - before,
        1
    );
}

/// Another admin of the team, who owns [`THEIRS`].
const OTHER_ADMIN: &str = "macro|someone@example.com";

fn other_admin() -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(OTHER_ADMIN),
        TEAM,
        EntityType::Team,
    )
}

#[tokio::test]
async fn only_the_inviter_or_the_hosts_owner_may_move_an_agent() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let before = journal.entries().len();

    let result = service
        .move_install(
            other_admin(),
            &agent.user_id,
            MoveTeammate { harness_id: THEIRS },
        )
        .await;

    assert!(
        matches!(result, Err(TeamAgentError::Forbidden(_))),
        "{result:?}"
    );
    assert_eq!(journal.entries().len(), before, "nothing checkpointed");
    let install = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(install.harness_id, LAPTOP);
    assert_eq!(install.checkpoint, None);
}

#[tokio::test]
async fn a_finished_move_revokes_the_old_machines_credentials_before_the_new_one_gets_any() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let old = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    service
        .issue_install(LAPTOP, old.install_id, None)
        .await
        .unwrap();
    service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: DESKTOP,
            },
        )
        .await
        .unwrap();
    // The target never comes back to take a delivery.
    set_connected(&service, DESKTOP, false);
    let before = journal.entries().len();

    service.finish_checkpoint(old.install_id).await.unwrap();

    let after = &journal.entries()[before..];
    assert!(
        after.iter().any(|entry| entry == "api_key.revoke_all"),
        "{after:?}"
    );
    assert!(
        after.iter().any(|entry| entry == "repo.create Sam Rivera"),
        "a fresh repository token voids the old machine's: {after:?}"
    );
    assert!(
        !after.iter().any(|entry| entry == "api_key.mint"),
        "{after:?}"
    );
}

fn install_of(service: &Service, agent: &TeamAgent) -> TeammateInstallRecord {
    service
        .installs
        .rows
        .lock()
        .unwrap()
        .iter()
        .find(|row| row.agent == agent.user_id)
        .cloned()
        .expect("the agent has an install")
}

/// What an admin sees of `agent` in Members.
async fn listed(service: &Service, agent: &TeamAgent) -> TeamAgent {
    service
        .list(receipt())
        .await
        .unwrap()
        .agents
        .into_iter()
        .find(|listed| listed.user_id == agent.user_id)
        .expect("the agent is still listed")
}

/// The agent kept its account, seat and repository: nothing took it back.
fn assert_kept(service: &Service, journal: &Journal) {
    assert_eq!(service.repository.records().len(), 1);
    let entries = journal.entries();
    for gone in [
        "team.take_back",
        "seat.remove",
        "repo.delete",
        "account.delete",
    ] {
        assert!(
            !entries.iter().any(|entry| entry.starts_with(gone)),
            "{gone}: {entries:?}"
        );
    }
}

#[tokio::test]
async fn a_machine_whose_owner_lost_admin_gets_nothing_and_its_agent_is_parked() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let install = install_of(&service, &agent);
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    let before = journal.entries().len();

    let issued = service
        .issue_install(LAPTOP, install.install_id, None)
        .await
        .unwrap();

    assert!(issued.is_none());
    // Parked first, so a delivery in flight is done before the revoke.
    assert_eq!(
        journal.entries()[before..],
        [
            "install.park".to_owned(),
            format!("runtimes.changed {LAPTOP}"),
            "api_key.revoke_all".to_owned(),
            "repo.create Sam Rivera".to_owned(),
            "install.revoked".to_owned(),
        ]
    );
    let parked = install_of(&service, &agent);
    assert!(parked.parked(), "{parked:?}");
    assert!(!parked.revoke_pending);
    assert_eq!(parked.checkpoint, None);
    assert_kept(&service, &journal);
    let shown = listed(&service, &agent).await;
    assert_eq!(shown.status, TeamAgentStatus::Paused);
    assert_eq!(
        shown.install_problem,
        Some(crate::domain::models::InstallProblem::HostRemoved)
    );
    // Parked, it gets nothing, whoever asks.
    assert!(
        service
            .issue_install(LAPTOP, install.install_id, None)
            .await
            .unwrap()
            .is_none()
    );
    assert!(!journal.entries().contains(&"api_key.mint".to_owned()));
}

#[tokio::test]
async fn the_sweep_parks_agents_only_on_the_machines_that_may_no_longer_host_them() {
    let (service, journal, _) = self_hosted_service();
    let leaving = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let staying = service
        .create(
            receipt(),
            CreateTeamAgent {
                purchase_key: "invite-2".to_owned(),
                name: "Ada".to_owned(),
                ..own(DESKTOP)
            },
        )
        .await
        .unwrap();
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    let before = journal.entries().len();

    let offboarded = service.offboard_unentitled_hosts().await.unwrap();

    assert_eq!(offboarded, 1);
    assert!(install_of(&service, &leaving).parked());
    assert!(!install_of(&service, &staying).parked());
    assert_eq!(
        journal.entries()[before..]
            .iter()
            .filter(|entry| *entry == "api_key.revoke_all")
            .count(),
        1
    );
    assert_eq!(service.repository.records().len(), 2);
    // Already parked: the next round leaves it alone.
    assert_eq!(service.offboard_unentitled_hosts().await.unwrap(), 0);
}

/// The team's owner, an admin who neither invited the agent nor hosts it.
const TEAM_OWNER: &str = "macro|owner@example.com";

fn team_owner() -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(TEAM_OWNER),
        TEAM,
        EntityType::Team,
    )
}

/// `agent`'s install, parked off `harness` by the sweep.
async fn parked_off(service: &Service, agent: &TeamAgent, harness: HarnessId) {
    service.installs.update(
        |row| row.agent == agent.user_id,
        |row| row.harness_id = harness,
    );
    service.installs.unentitled.lock().unwrap().push(harness);
    service.offboard_unentitled_hosts().await.unwrap();
    assert!(install_of(service, agent).parked());
}

#[tokio::test]
async fn another_admin_cant_take_over_a_parked_agent() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    parked_off(&service, &agent, LAPTOP).await;
    let before = journal.entries().len();

    // Neither its inviter, nor the team's owner, nor its machine's owner:
    // its new machine would get the agent's key, DMs and shares.
    let result = service
        .move_install(
            other_admin(),
            &agent.user_id,
            MoveTeammate { harness_id: THEIRS },
        )
        .await;

    assert!(
        matches!(result, Err(TeamAgentError::Forbidden(_))),
        "{result:?}"
    );
    assert_eq!(journal.entries().len(), before, "nothing checkpointed");
    assert!(install_of(&service, &agent).parked());
}

#[tokio::test]
async fn the_teams_owner_may_host_a_parked_agent_on_a_machine_of_theirs() {
    const OWNERS: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d05));
    let (service, journal, _) = self_hosted_service();
    service.installs.hosts.lock().unwrap().push((
        user(TEAM_OWNER),
        host(OWNERS, "Owner's", true, Some(docker_linux())),
    ));
    service
        .installs
        .team_owners
        .lock()
        .unwrap()
        .push(user(TEAM_OWNER));
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    parked_off(&service, &agent, LAPTOP).await;
    let parked = install_of(&service, &agent);

    // LAPTOP is still connected, but runs nothing, so nothing is waited for.
    let moved = service
        .move_install(
            team_owner(),
            &agent.user_id,
            MoveTeammate { harness_id: OWNERS },
        )
        .await
        .unwrap();

    assert_eq!(moved.harness_id, Some(OWNERS));
    assert_eq!(moved.install_problem, None);
    let install = install_of(&service, &agent);
    assert!(!install.parked());
    assert!(!install.revoke_pending);
    assert_ne!(install.install_id, parked.install_id);
    assert_eq!(
        journal.entries().last().unwrap(),
        &format!("runtimes.changed {OWNERS}")
    );
    let issued = service
        .issue_install(OWNERS, install.install_id, None)
        .await
        .unwrap()
        .expect("the new machine gets the agent");
    assert_eq!(issued.generation, parked.generation + 1);
    assert_kept(&service, &journal);
}

#[tokio::test]
async fn a_parked_agents_host_owner_may_host_it_again_only_once_entitled_again() {
    let (service, _, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    // Hosted on the other admin's machine, which then loses its right.
    parked_off(&service, &agent, THEIRS).await;
    let move_back = || {
        service.move_install(
            other_admin(),
            &agent.user_id,
            MoveTeammate { harness_id: THEIRS },
        )
    };

    // Still demoted (or the machine unpaired): refused.
    let refused = move_back().await;
    assert!(
        matches!(refused, Err(TeamAgentError::Forbidden(_))),
        "{refused:?}"
    );
    assert!(install_of(&service, &agent).parked());

    // An admin again, the machine still paired.
    service.installs.unentitled.lock().unwrap().clear();
    let moved = move_back().await.unwrap();

    assert_eq!(moved.harness_id, Some(THEIRS));
    assert!(!install_of(&service, &agent).parked());
}

#[tokio::test]
async fn a_brief_demotion_loses_nothing_and_the_agent_can_be_hosted_on_the_same_machine_again() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    service.offboard_unentitled_hosts().await.unwrap();
    // Promoted back.
    service.installs.unentitled.lock().unwrap().clear();
    let parked = install_of(&service, &agent);

    // Still parked until someone hosts it again: nothing restarts by itself.
    assert!(
        service
            .issue_install(LAPTOP, parked.install_id, None)
            .await
            .unwrap()
            .is_none()
    );
    let moved = service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate { harness_id: LAPTOP },
        )
        .await
        .unwrap();

    assert_eq!(moved.harness_id, Some(LAPTOP));
    let install = install_of(&service, &agent);
    assert_ne!(install.install_id, parked.install_id, "a fresh volume");
    assert!(
        service
            .issue_install(LAPTOP, install.install_id, None)
            .await
            .unwrap()
            .is_some()
    );
    assert_kept(&service, &journal);
    assert_eq!(listed(&service, &agent).await.install_problem, None);
}

#[tokio::test]
async fn an_unpaired_and_repaired_machine_loses_nothing_and_hosts_the_agent_again() {
    const REPAIRED: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d04));
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    // Unpaired: LAPTOP is gone.
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    set_connected(&service, LAPTOP, false);
    service.offboard_unentitled_hosts().await.unwrap();
    assert!(install_of(&service, &agent).parked());
    // Paired again, as a new machine.
    service.installs.hosts.lock().unwrap().push((
        user(ADMIN),
        host(REPAIRED, "Laptop", true, Some(docker_linux())),
    ));

    service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: REPAIRED,
            },
        )
        .await
        .unwrap();

    let install = install_of(&service, &agent);
    assert_eq!(install.harness_id, REPAIRED);
    assert!(
        service
            .issue_install(REPAIRED, install.install_id, None)
            .await
            .unwrap()
            .is_some()
    );
    assert_kept(&service, &journal);
}

#[tokio::test]
async fn removing_a_parked_agent_finishes_at_once() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    service.offboard_unentitled_hosts().await.unwrap();

    service.delete(receipt(), &agent.user_id).await.unwrap();

    assert!(service.repository.records().is_empty());
    assert!(
        journal
            .entries()
            .contains(&format!("team.take_back {TEAM} by {ADMIN}"))
    );
}

#[tokio::test]
async fn a_failed_revoke_at_a_finished_move_holds_deliveries_until_the_sweep_retries_it() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let old = install_of(&service, &agent);
    service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: DESKTOP,
            },
        )
        .await
        .unwrap();
    service.api_keys.fail_revokes(true);

    let finished = service.finish_checkpoint(old.install_id).await;

    assert!(finished.is_err(), "{finished:?}");
    let moved = install_of(&service, &agent);
    assert_eq!(moved.harness_id, DESKTOP);
    assert!(moved.revoke_pending);
    // The old machine's key may still be live, so the new machine gets
    // nothing a late revoke could void.
    assert!(
        service
            .issue_install(DESKTOP, moved.install_id, None)
            .await
            .unwrap()
            .is_none()
    );
    // A retry of the stop finds nothing to finish.
    service.finish_checkpoint(old.install_id).await.unwrap();
    assert!(install_of(&service, &agent).revoke_pending);

    service.api_keys.fail_revokes(false);
    let before = journal.entries().len();
    service.offboard_unentitled_hosts().await.unwrap();

    assert_eq!(
        journal.entries()[before..],
        [
            "api_key.revoke_all".to_owned(),
            "repo.create Sam Rivera".to_owned(),
            "install.revoked".to_owned(),
            format!("runtimes.changed {DESKTOP}"),
        ]
    );
    assert!(
        service
            .issue_install(DESKTOP, moved.install_id, None)
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn deleting_a_team_takes_its_agents_off_their_machines_and_revokes_their_keys() {
    let (service, journal, _) = self_hosted_service();
    service.create(receipt(), own(LAPTOP)).await.unwrap();
    let release = crate::domain::service::InstallOffboarding::new(
        service.repository.clone(),
        FakeApiKeys(journal.clone(), Arc::default()),
        FakeRepos(journal.clone()),
        service.installs.clone(),
        FakeRuntimes(journal.clone()),
    );
    let before = journal.entries().len();

    release
        .release_team(Uuid::parse_str(TEAM).unwrap())
        .await
        .unwrap();

    assert_eq!(
        journal.entries()[before..],
        [
            "install.park".to_owned(),
            "api_key.revoke_all".to_owned(),
            "repo.create Sam Rivera".to_owned(),
            "install.delete".to_owned(),
            format!("runtimes.changed {LAPTOP}"),
        ]
    );
    assert!(service.installs.rows.lock().unwrap().is_empty());
    // Again: nothing left to do.
    release
        .release_team(Uuid::parse_str(TEAM).unwrap())
        .await
        .unwrap();
    assert_eq!(journal.entries().len(), before + 5);
}

#[tokio::test]
async fn a_team_release_whose_revoke_fails_keeps_the_install_for_the_retry() {
    let (service, journal, _) = self_hosted_service();
    service.create(receipt(), own(LAPTOP)).await.unwrap();
    let keys = FakeApiKeys(journal.clone(), Arc::new(AtomicBool::new(true)));
    let release = crate::domain::service::InstallOffboarding::new(
        service.repository.clone(),
        keys,
        FakeRepos(journal.clone()),
        service.installs.clone(),
        FakeRuntimes(journal.clone()),
    );

    assert!(
        release
            .release_team(Uuid::parse_str(TEAM).unwrap())
            .await
            .is_err()
    );

    let rows = service.installs.rows.lock().unwrap().clone();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].parked() && rows[0].revoke_pending, "{rows:?}");
}

/// Whether the machine's latest key still works: no revoke since the last
/// mint.
fn machines_key_works(journal: &Journal) -> bool {
    journal
        .entries()
        .iter()
        .rev()
        .find(|entry| *entry == "api_key.mint" || *entry == "api_key.revoke_all")
        .is_some_and(|entry| entry == "api_key.mint")
}

/// Whether the machine's repository token still works: no token was issued
/// after the one its latest delivery carried (the repository create right
/// after the last mint).
fn machines_repo_token_works(journal: &Journal) -> bool {
    let entries = journal.entries();
    let Some(last_mint) = entries.iter().rposition(|entry| entry == "api_key.mint") else {
        return false;
    };
    entries[last_mint + 1..]
        .iter()
        .filter(|entry| entry.starts_with("repo.create"))
        .count()
        == 1
}

#[tokio::test]
async fn a_parked_agents_key_and_repository_token_are_void_once_it_is_parked() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let install = install_of(&service, &agent);
    service
        .issue_install(LAPTOP, install.install_id, None)
        .await
        .unwrap()
        .expect("the machine gets the agent");
    assert!(machines_key_works(&journal));
    assert!(machines_repo_token_works(&journal));

    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    service.offboard_unentitled_hosts().await.unwrap();

    // Revoked by the time parking returns, before anything else is issued.
    assert!(install_of(&service, &agent).parked());
    assert!(!machines_key_works(&journal));
    assert!(!machines_repo_token_works(&journal));
    // The old machine asking again gets nothing new.
    assert!(
        service
            .issue_install(LAPTOP, install.install_id, Some((1, 1)))
            .await
            .unwrap()
            .is_none()
    );
    assert!(!machines_key_works(&journal));
}

#[tokio::test]
async fn nothing_is_minted_for_a_parked_agent_while_its_revoke_is_pending() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let install = install_of(&service, &agent);
    service
        .issue_install(LAPTOP, install.install_id, None)
        .await
        .unwrap();
    service.api_keys.fail_revokes(true);
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    service.offboard_unentitled_hosts().await.unwrap();
    assert!(install_of(&service, &agent).revoke_pending);

    // Its inviter hosts it elsewhere while the old key may still be live.
    let moved = service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: DESKTOP,
            },
        )
        .await;
    assert!(
        moved.is_err(),
        "the revoke at the move fails too: {moved:?}"
    );
    let on_desktop = install_of(&service, &agent);
    assert_eq!(on_desktop.harness_id, DESKTOP);
    assert!(on_desktop.revoke_pending);
    let mints = |journal: &Journal| {
        journal
            .entries()
            .iter()
            .filter(|entry| *entry == "api_key.mint")
            .count()
    };
    let before = mints(&journal);
    for reported in [None, Some((0, 0))] {
        assert!(
            service
                .issue_install(DESKTOP, on_desktop.install_id, reported)
                .await
                .unwrap()
                .is_none()
        );
    }
    assert_eq!(mints(&journal), before, "no key while the old one may live");

    // The sweep's retry revokes, then the new machine gets its first key.
    service.api_keys.fail_revokes(false);
    service.offboard_unentitled_hosts().await.unwrap();
    assert!(
        service
            .issue_install(DESKTOP, on_desktop.install_id, None)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(mints(&journal), before + 1);
}

#[tokio::test]
async fn a_move_revokes_the_old_machines_key_before_the_new_machine_is_minted_one() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let old = install_of(&service, &agent);
    service
        .issue_install(LAPTOP, old.install_id, None)
        .await
        .unwrap();
    service
        .move_install(
            receipt(),
            &agent.user_id,
            MoveTeammate {
                harness_id: DESKTOP,
            },
        )
        .await
        .unwrap();
    // Checkpointing: the old machine still runs it, and the new one waits.
    assert!(machines_key_works(&journal));
    let before = journal.entries().len();

    service.finish_checkpoint(old.install_id).await.unwrap();
    let moved = install_of(&service, &agent);
    service
        .issue_install(DESKTOP, moved.install_id, None)
        .await
        .unwrap()
        .expect("the new machine gets the agent");

    let after = &journal.entries()[before..];
    let revoked = after
        .iter()
        .position(|entry| entry == "api_key.revoke_all")
        .expect("the old key is revoked");
    let minted = after
        .iter()
        .position(|entry| entry == "api_key.mint")
        .expect("the new machine is minted a key");
    assert!(revoked < minted, "{after:?}");
}

#[tokio::test]
async fn a_membership_change_parks_the_agents_it_unentitled_at_once() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let offboarding = crate::domain::service::InstallOffboarding::new(
        service.repository.clone(),
        FakeApiKeys(journal.clone(), Arc::default()),
        FakeRepos(journal.clone()),
        service.installs.clone(),
        FakeRuntimes(journal.clone()),
    );
    // Nothing changed yet: nothing to park.
    assert_eq!(offboarding.offboard_unentitled().await.unwrap(), 0);

    // The host was just removed from the team or demoted.
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    assert_eq!(offboarding.offboard_unentitled().await.unwrap(), 1);

    let parked = install_of(&service, &agent);
    assert!(parked.parked() && !parked.revoke_pending, "{parked:?}");
    assert!(
        journal
            .entries()
            .contains(&format!("runtimes.changed {LAPTOP}"))
    );
    assert_kept(&service, &journal);
}

/// Repositories whose first token issue waits until released, so a sweep
/// can be held mid-page.
struct GatedRepos {
    journal: Journal,
    gated: std::sync::atomic::AtomicBool,
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
}

impl AgentRepos for GatedRepos {
    async fn create(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
        seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        if self.gated.swap(false, Ordering::SeqCst) {
            self.entered.notify_one();
            self.release.notified().await;
        }
        self.journal.record(format!("repo.create {}", seed.name));
        Ok(AgentRepo {
            url: "https://git.example.com/ada.git".to_owned(),
            token: RepoToken::generate(),
        })
    }

    async fn delete(&self, _: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        unreachable!("sweeps delete no repository")
    }

    async fn voice(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
    ) -> Result<Option<VoiceModel>, TeamAgentError> {
        unreachable!("sweeps read no voice")
    }

    async fn set_voice(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
        _: &VoiceModel,
    ) -> Result<(), TeamAgentError> {
        unreachable!("sweeps set no voice")
    }
}

#[tokio::test]
async fn a_stale_sweep_cant_void_the_key_a_moved_agent_was_just_given() {
    let (service, journal, _) = self_hosted_service();
    // Ada first, so a sweep reaches her before Sam.
    let ada = service
        .create(
            receipt(),
            CreateTeamAgent {
                purchase_key: "invite-2".to_owned(),
                name: "Ada".to_owned(),
                ..own(LAPTOP)
            },
        )
        .await
        .unwrap();
    let sam = service.create(receipt(), own(LAPTOP)).await.unwrap();
    // Both move to the desktop, and both revokes at the move fail.
    service.api_keys.fail_revokes(true);
    for agent in [&ada, &sam] {
        let old = install_of(&service, agent);
        service
            .move_install(
                receipt(),
                &agent.user_id,
                MoveTeammate {
                    harness_id: DESKTOP,
                },
            )
            .await
            .unwrap();
        assert!(service.finish_checkpoint(old.install_id).await.is_err());
        assert!(install_of(&service, agent).revoke_pending);
    }
    service.api_keys.fail_revokes(false);

    // Sweep B lists both pending revokes, then stalls on Ada's.
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let stale = Arc::new(crate::domain::service::InstallOffboarding::new(
        service.repository.clone(),
        FakeApiKeys(journal.clone(), Arc::default()),
        GatedRepos {
            journal: journal.clone(),
            gated: std::sync::atomic::AtomicBool::new(true),
            entered: entered.clone(),
            release: release.clone(),
        },
        service.installs.clone(),
        FakeRuntimes(journal.clone()),
    ));
    let sweep_b = tokio::spawn({
        let stale = stale.clone();
        async move { stale.offboard_unentitled().await }
    });
    entered.notified().await;

    // Sweep A revokes both meanwhile, and Sam's new machine is minted a key.
    service.offboard_unentitled_hosts().await.unwrap();
    let moved = install_of(&service, &sam);
    assert!(!moved.revoke_pending);
    service
        .issue_install(DESKTOP, moved.install_id, None)
        .await
        .unwrap()
        .expect("the new machine gets Sam");
    let minted = journal.entries().len();

    // Sweep B goes on with what it listed.
    release.notify_one();
    sweep_b.await.unwrap().unwrap();

    let after = &journal.entries()[minted..];
    assert!(
        !after
            .iter()
            .any(|entry| entry == "api_key.revoke_all" || entry == "repo.create Sam Rivera"),
        "a stale sweep voided Sam's new key or repository token: {after:?}"
    );
    assert!(machines_key_works(&journal));
}

#[tokio::test]
async fn an_unpair_parks_only_that_machines_agents() {
    let (service, _, _) = self_hosted_service();
    let on_laptop = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let on_desktop = service
        .create(
            receipt(),
            CreateTeamAgent {
                purchase_key: "invite-2".to_owned(),
                name: "Ada".to_owned(),
                ..own(DESKTOP)
            },
        )
        .await
        .unwrap();
    // Both machines lost the right; only the laptop was just unpaired.
    service
        .installs
        .unentitled
        .lock()
        .unwrap()
        .extend([LAPTOP, DESKTOP]);

    assert_eq!(service.offboard_host(LAPTOP).await.unwrap(), 1);

    assert!(install_of(&service, &on_laptop).parked());
    assert!(
        !install_of(&service, &on_desktop).parked(),
        "left to the sweep"
    );
    assert_eq!(service.offboard_host(LAPTOP).await.unwrap(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_revoke_whose_calls_hang_gives_up_and_stays_pending_for_the_sweep() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    service
        .installs
        .park(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    // agent_git never answers.
    let hanging = crate::domain::service::InstallOffboarding::new(
        service.repository.clone(),
        FakeApiKeys(journal.clone(), Arc::default()),
        GatedRepos {
            journal: journal.clone(),
            gated: std::sync::atomic::AtomicBool::new(true),
            entered: Arc::new(tokio::sync::Notify::new()),
            release: Arc::new(tokio::sync::Notify::new()),
        },
        service.installs.clone(),
        FakeRuntimes(journal.clone()),
    );

    // The row lock is held only as long as the revoke's bounded calls.
    let round = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        hanging.offboard_unentitled(),
    )
    .await
    .expect("the revoke gives up instead of holding the row");

    assert_eq!(round.unwrap(), 0);
    assert!(
        install_of(&service, &agent).revoke_pending,
        "left for the sweep"
    );
    assert!(!journal.entries().contains(&"install.revoked".to_owned()));
}

#[tokio::test(start_paused = true)]
async fn one_hanging_revoke_doesnt_keep_the_machines_other_agents_running() {
    let (service, journal, _) = self_hosted_service();
    // Ada's revoke hangs (her repository token never comes back); Sam's
    // doesn't.
    let ada = service
        .create(
            receipt(),
            CreateTeamAgent {
                purchase_key: "invite-2".to_owned(),
                name: "Ada".to_owned(),
                ..own(LAPTOP)
            },
        )
        .await
        .unwrap();
    let sam = service.create(receipt(), own(LAPTOP)).await.unwrap();
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    let hanging = GatedRepos {
        journal: journal.clone(),
        gated: std::sync::atomic::AtomicBool::new(true),
        entered: Arc::new(tokio::sync::Notify::new()),
        release: Arc::new(tokio::sync::Notify::new()),
    };
    let keys = FakeApiKeys(journal.clone(), Arc::default());
    let runtimes = FakeRuntimes(journal.clone());
    let offboarding = crate::domain::service::self_hosted::Offboarding {
        repository: &service.repository,
        api_keys: &keys,
        repos: &hanging,
        installs: &service.installs,
        runtimes: &runtimes,
    };

    // The unpair's call to the auth service gives up after 10 s, network
    // and parking included: the round must end well inside it.
    let unpair_call = std::time::Duration::from_secs(10);
    let headroom = std::time::Duration::from_secs(2);
    let parked = tokio::time::timeout(unpair_call - headroom, offboarding.offboard_host(LAPTOP))
        .await
        .expect("the round ends inside the unpair call's budget");
    assert_eq!(parked.unwrap(), 2);

    let ada = install_of(&service, &ada);
    let sam = install_of(&service, &sam);
    assert!(
        ada.parked() && sam.parked(),
        "both stopped: {ada:?} {sam:?}"
    );
    assert!(!sam.revoke_pending, "Sam's credentials revoked");
    assert!(ada.revoke_pending, "Ada's left for the sweep");
}
