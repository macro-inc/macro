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

#[tokio::test]
async fn a_machine_whose_owner_lost_admin_gets_nothing_and_its_agent_comes_off() {
    let (service, journal, _) = self_hosted_service();
    let agent = service.create(receipt(), own(LAPTOP)).await.unwrap();
    let install = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    service.installs.unentitled.lock().unwrap().push(LAPTOP);
    let before = journal.entries().len();

    let issued = service
        .issue_install(LAPTOP, install.install_id, None)
        .await
        .unwrap();

    assert!(issued.is_none());
    let after = &journal.entries()[before..];
    assert!(
        !after.iter().any(|entry| entry == "api_key.mint"),
        "{after:?}"
    );
    assert!(
        after.iter().any(|entry| entry == "api_key.revoke_all"),
        "{after:?}"
    );
    assert!(
        after.iter().any(|entry| entry == "repo.create Sam Rivera"),
        "{after:?}"
    );
    let removing = service
        .installs
        .for_agent(&agent.user_id)
        .await
        .unwrap()
        .unwrap();
    assert!(
        matches!(removing.checkpoint, Some((Checkpoint::Removing, _))),
        "{removing:?}"
    );
}

#[tokio::test]
async fn the_sweep_takes_agents_off_only_the_machines_that_may_no_longer_host_them() {
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
    let checkpoint = |agent: &TeamAgent| {
        service
            .installs
            .rows
            .lock()
            .unwrap()
            .iter()
            .find(|row| row.agent == agent.user_id)
            .and_then(|row| row.checkpoint.map(|(checkpoint, _)| checkpoint))
    };
    assert_eq!(checkpoint(&leaving), Some(Checkpoint::Removing));
    assert_eq!(checkpoint(&staying), None);
    assert_eq!(
        journal.entries()[before..]
            .iter()
            .filter(|entry| *entry == "api_key.revoke_all")
            .count(),
        1
    );
    // Already being removed: the next round leaves it alone.
    assert_eq!(service.offboard_unentitled_hosts().await.unwrap(), 0);
}
