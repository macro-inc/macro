//! The boot against real git repositories in a temporary directory, as
//! `test-start-agent.sh` tested `start-agent` (its cases B7 to B11).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use super::git::ProcessGit;
use super::local::LocalFs;
use super::process::{self, Limits, ProcessError};
use super::*;
use crate::boot::SettingsProblem;

/// One case: a remote with the template commit, the image's runtime, the
/// state files and agent.env.
struct Case {
    _root: tempfile::TempDir,
    root: PathBuf,
    paths: BootPaths,
    git: ProcessGit,
}

const AGENT_ENV: &str = "MACRO_REPO_URL=https://git.test/agent.git\nMACRO_REPO_TOKEN=t\nMACRO_AGENT_USER_ID=\"macro|agent@example.com\"\nMACRO_AGENT_NAME=Fox\n";
const TEMPLATE_PACKAGE: &str = r#"{"name":"agent","dependencies":{"zod":"4.4.3"}}"#;

impl Case {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().to_owned();
        std::fs::create_dir_all(root.join("home")).unwrap();
        std::fs::create_dir_all(root.join("state")).unwrap();
        std::fs::create_dir_all(root.join("runtime/node_modules")).unwrap();
        std::fs::write(
            root.join("gitconfig"),
            format!(
                "[url \"file://{}/remote.git\"]\n\tinsteadOf = https://git.test/agent.git\n[init]\n\tdefaultBranch = main\n[user]\n\tname = t\n\temail = t@t\n",
                root.display()
            ),
        )
        .unwrap();
        // git for the boot, with this case's config: the repository URL
        // must be HTTP(S); git reads a local bare repository instead.
        let wrapper = root.join("git");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nexport GIT_CONFIG_GLOBAL={0}/gitconfig GIT_CONFIG_NOSYSTEM=1 HOME={0}/home\nexec git \"$@\"\n",
                root.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(
            &wrapper,
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .unwrap();

        let case = Self {
            paths: BootPaths {
                workspace: root.join("workspace"),
                last_good: root.join("state/last-good"),
                failed_boots: root.join("state/failed-boots"),
                boot_head: root.join("state/boot-head"),
                runtime: root.join("runtime"),
                credentials: root.join("agent.env"),
            },
            git: ProcessGit {
                program: wrapper,
                ..ProcessGit::new(
                    root.join("workspace"),
                    Path::new("true"),
                    &root.join("agent.env"),
                )
            },
            root,
            _root: directory,
        };
        std::fs::write(&case.paths.credentials, AGENT_ENV).unwrap();
        std::fs::write(case.root.join("runtime/bun.lock"), "lock v1\n").unwrap();
        case.git_in(&case.root, &["init", "-q", "--bare", "remote.git"]);
        let seed = case.root.join("seed");
        std::fs::create_dir_all(&seed).unwrap();
        case.git_in(&seed, &["init", "-q"]);
        std::fs::write(seed.join("package.json"), TEMPLATE_PACKAGE).unwrap();
        std::fs::write(seed.join("bun.lock"), "lock v1\n").unwrap();
        std::fs::write(seed.join("cli.ts"), "export {}\n").unwrap();
        case.git_in(&seed, &["add", "-A"]);
        case.git_in(&seed, &["commit", "-qm", "template"]);
        let remote = case.root.join("remote.git");
        case.git_in(
            &seed,
            &["push", "-q", remote.to_str().unwrap(), "HEAD:main"],
        );
        case
    }

    fn git_in(&self, directory: &Path, arguments: &[&str]) -> String {
        let output = Command::new(&self.git.program)
            .current_dir(directory)
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {arguments:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn ws(&self, arguments: &[&str]) -> String {
        self.git_in(&self.paths.workspace, arguments)
    }

    async fn boot(&self, previous: PreviousExit) -> BootOutcome {
        let boot = Boot {
            git: self.git.clone(),
            fs: LocalFs,
            paths: &self.paths,
        };
        boot.run(previous).await.unwrap()
    }

    fn state(&self, path: &Path) -> String {
        std::fs::read_to_string(path).unwrap().trim().to_owned()
    }

    fn write(&self, relative: &str, contents: &str) {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    /// The agent's code, committed: it needs this muppet API.
    fn needs_muppet(&self, level: &str) {
        self.write(
            "workspace/package.json",
            &format!(r#"{{"name":"agent","muppetApi":{level},"dependencies":{{"zod":"4.4.3"}}}}"#),
        );
        self.ws(&["commit", "-qam", &format!("needs muppet API {level}")]);
    }

    fn image_muppet(&self, level: &str) {
        self.write(
            "runtime/node_modules/@macro-inc/muppet/package.json",
            &format!(r#"{{"name":"@macro-inc/muppet","apiLevel":{level}}}"#),
        );
    }
}

const UNKNOWN: PreviousExit = PreviousExit::Unknown;

fn head_of(outcome: &BootOutcome) -> String {
    match outcome {
        BootOutcome::Run { head } => head.to_string(),
        BootOutcome::Exit(end) => panic!("exited: {end}"),
    }
}

#[tokio::test]
async fn a_first_boot_clones_configures_and_links() {
    let case = Case::new();
    let outcome = case.boot(UNKNOWN).await;
    let head = head_of(&outcome);
    assert_eq!(case.ws(&["rev-parse", "HEAD"]), head);
    assert_eq!(case.state(&case.paths.boot_head), head);
    assert_eq!(case.state(&case.paths.failed_boots), "0");
    assert_eq!(
        std::fs::read_link(case.paths.workspace.join("node_modules")).unwrap(),
        case.paths.runtime.join("node_modules")
    );
    assert_eq!(case.ws(&["config", "user.email"]), "agent@example.com");
    assert_eq!(case.ws(&["config", "user.name"]), "Fox");
    assert_eq!(
        case.ws(&["config", "--null", "--get-all", "credential.helper"]),
        format!("\0!true {}\0", case.paths.credentials.display())
    );
    assert_eq!(
        case.ws(&["config", "remote.origin.url"]),
        "https://git.test/agent.git"
    );
    // No clone staging left beside it.
    let leftovers: Vec<_> = std::fs::read_dir(&case.root)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().contains(".clone."))
        .collect();
    assert!(leftovers.is_empty());
}

#[tokio::test]
async fn b7_an_unchanged_agent_adopts_the_image_lock() {
    let case = Case::new();
    case.boot(UNKNOWN).await;
    case.write("runtime/bun.lock", "lock v2\n");
    let head = head_of(&case.boot(PreviousExit::Exited { code: 0 }).await);
    assert_eq!(
        std::fs::read(case.paths.workspace.join("bun.lock")).unwrap(),
        b"lock v2\n"
    );
    assert_eq!(
        case.ws(&["log", "-1", "--format=%s"]),
        "chore(agent): adopt the image's bun.lock"
    );
    assert_eq!(case.state(&case.paths.boot_head), head);
}

#[tokio::test]
async fn b7_an_agent_that_changed_its_dependencies_with_no_last_good_needs_a_new_image() {
    let case = Case::new();
    case.boot(UNKNOWN).await;
    case.write(
        "workspace/package.json",
        r#"{"name":"agent","dependencies":{"zod":"4.4.3","left-pad":"1.3.0"}}"#,
    );
    case.ws(&["commit", "-qam", "self-edit: add left-pad"]);
    case.write("runtime/bun.lock", "lock v2\n");
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::DependenciesChanged)
    );
    // Recorded against the edit.
    assert_eq!(
        case.state(&case.paths.boot_head),
        case.ws(&["rev-parse", "HEAD"])
    );

    let good = case.ws(&["rev-parse", "HEAD~1"]);
    case.write("state/last-good", &good);
    case.write("state/failed-boots", "2");
    head_of(&case.boot(PreviousExit::Exited { code: 1 }).await);
    assert_eq!(
        std::fs::read(case.paths.workspace.join("bun.lock")).unwrap(),
        b"lock v2\n"
    );
}

#[tokio::test]
async fn b7a_a_package_json_changed_outside_its_dependencies_boots() {
    let case = Case::new();
    case.boot(UNKNOWN).await;
    case.write(
        "workspace/package.json",
        r#"{"name":"agent","scripts":{"check":"bun test"},"dependencies":{"zod":"4.4.3"}}"#,
    );
    case.ws(&["commit", "-qam", "self-edit: a check script"]);
    case.write("runtime/bun.lock", "lock v2\n");
    head_of(&case.boot(UNKNOWN).await);

    case.write(
        "workspace/package.json",
        r#"{"name":"agent","dependencies":{"zod":"4.4.3"},"devDependencies":{"typescript":"5.9.3"}}"#,
    );
    case.ws(&["commit", "-qam", "self-edit: a dev dependency"]);
    case.write("runtime/bun.lock", "lock v3\n");
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::DependenciesChanged)
    );
}

#[tokio::test]
async fn b8_a_rollback_survives_the_next_pull_rebase() {
    let case = Case::new();
    case.boot(UNKNOWN).await;
    let good = case.ws(&["rev-parse", "HEAD"]);
    case.write("state/last-good", &good);
    case.write("workspace/cli.ts", "broken\n");
    case.ws(&["commit", "-qam", "self-edit: break it"]);
    case.ws(&["push", "-q", "origin", "HEAD:main"]);
    let broken = case.ws(&["rev-parse", "HEAD"]);
    case.write("state/boot-head", &broken);
    case.write("state/failed-boots", "2");

    // The third failed boot of the broken head.
    let head = head_of(&case.boot(PreviousExit::Exited { code: 1 }).await);
    let good_tree = case.ws(&["rev-parse", &format!("{good}^{{tree}}")]);
    assert_eq!(case.ws(&["rev-parse", "HEAD^{tree}"]), good_tree);
    case.ws(&["merge-base", "--is-ancestor", &broken, "HEAD"]);
    assert!(case.ws(&["log", "-1", "--format=%s"]).starts_with(&format!(
        "revert(agent): roll back to last-good {} after 3 failed boots",
        &good[..12]
    )));
    assert_eq!(case.state(&case.paths.failed_boots), "0");
    assert_eq!(case.state(&case.paths.boot_head), head);
    assert_eq!(case.state(&case.paths.last_good), head);
    case.ws(&["pull", "-q", "--rebase", "origin", "main"]);
    assert_eq!(case.ws(&["rev-parse", "HEAD^{tree}"]), good_tree);

    // An early death of the rolled-back code doesn't count, and the next
    // boot doesn't take its own rollback for a dependency edit.
    head_of(&case.boot(PreviousExit::Exited { code: 1 }).await);
    assert_eq!(case.state(&case.paths.failed_boots), "0");
}

#[tokio::test]
async fn b9_the_previous_exit_is_counted_against_the_boot_head() {
    let case = Case::new();
    let good = head_of(&case.boot(UNKNOWN).await);
    case.write("state/last-good", &good);
    case.write("workspace/cli.ts", "changed\n");
    case.ws(&["commit", "-qam", "self-edit"]);
    case.boot(PreviousExit::Exited { code: 75 }).await;
    case.boot(PreviousExit::Exited { code: 78 }).await;
    assert_eq!(case.state(&case.paths.failed_boots), "1");
    case.boot(PreviousExit::Exited { code: 75 }).await;
    case.boot(PreviousExit::Exited { code: 0 }).await;
    case.boot(PreviousExit::Exited { code: 79 }).await;
    assert_eq!(case.state(&case.paths.failed_boots), "1");
    // Lost, of a boot that never marked itself healthy: counted once.
    case.boot(UNKNOWN).await;
    assert_eq!(case.state(&case.paths.failed_boots), "2");
    // The third: this boot rolls back, and the count starts again.
    let head = head_of(&case.boot(PreviousExit::Exited { code: 137 }).await);
    assert_eq!(case.state(&case.paths.failed_boots), "0");
    assert_eq!(case.state(&case.paths.last_good), head);
}

#[tokio::test]
async fn b10_muppet_levels() {
    let case = Case::new();
    case.boot(UNKNOWN).await;
    case.needs_muppet("2");
    case.image_muppet("1");
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::NeedsNewerImage { needs: 2, has: 1 })
    );
    assert_eq!(
        case.state(&case.paths.boot_head),
        case.ws(&["rev-parse", "HEAD"])
    );

    case.image_muppet("2");
    head_of(&case.boot(UNKNOWN).await);
    case.image_muppet("3");
    head_of(&case.boot(UNKNOWN).await);

    std::fs::remove_dir_all(case.root.join("runtime/node_modules/@macro-inc")).unwrap();
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::NeedsNewerImage { needs: 2, has: 0 })
    );
    case.write(
        "runtime/node_modules/@macro-inc/muppet/package.json",
        r#"{"name":"@macro-inc/muppet"}"#,
    );
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::NeedsNewerImage { needs: 2, has: 0 })
    );
    case.image_muppet(r#""one""#);
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::GarbledImageLevel)
    );

    case.image_muppet("1");
    case.needs_muppet(r#""two""#);
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::GarbledNeed)
    );
    case.needs_muppet("9223372036854775808");
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::GarbledNeed)
    );
}

#[tokio::test]
async fn b10_a_land_too_new_for_the_image_rolls_back_in_the_same_boot() {
    let case = Case::new();
    case.boot(UNKNOWN).await;
    let good = case.ws(&["rev-parse", "HEAD"]);
    case.write("state/last-good", &good);
    case.needs_muppet("2");
    case.image_muppet("1");
    let head = head_of(&case.boot(PreviousExit::Exited { code: 75 }).await);
    let good_tree = case.ws(&["rev-parse", &format!("{good}^{{tree}}")]);
    assert_eq!(case.ws(&["rev-parse", "HEAD^{tree}"]), good_tree);
    assert_eq!(
        case.ws(&["log", "-1", "--format=%s"]),
        format!(
            "revert(agent): roll back to last-good {}: its code needs muppet API 2, the image has 1",
            &good[..12]
        )
    );
    assert_eq!(case.state(&case.paths.last_good), head);
    assert_eq!(case.state(&case.paths.boot_head), head);
}

#[tokio::test]
async fn b10_a_last_good_that_needs_more_too_stops_with_79() {
    let case = Case::new();
    case.boot(UNKNOWN).await;
    case.needs_muppet("2");
    case.write("state/last-good", &case.ws(&["rev-parse", "HEAD"]));
    // The older image adopts its own lock: a new head.
    case.write("runtime/bun.lock", "lock v2\n");
    case.image_muppet("1");
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::NeedsNewerImage { needs: 2, has: 1 })
    );
}

#[tokio::test]
async fn a_78_on_last_good_ends_the_next_boot_with_77() {
    let case = Case::new();
    let head = head_of(&case.boot(UNKNOWN).await);
    case.write("state/last-good", &head);
    let outcome = case.boot(PreviousExit::Exited { code: 78 }).await;
    assert_eq!(outcome, BootOutcome::Exit(BootExit::SettingsWrongNotCode));
    assert_eq!(BootExit::SettingsWrongNotCode.code(), 77);
}

#[tokio::test]
async fn a_bad_agent_env_is_78_before_the_workspace_is_touched() {
    let case = Case::new();
    case.write("agent.env", "MACRO_REPO_URL=https://git.test/agent.git\n");
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::InvalidSetting(SettingsProblem::Missing(
            "MACRO_REPO_TOKEN"
        )))
    );
    assert!(!case.paths.workspace.exists());

    case.write(
        "agent.env",
        "MACRO_REPO_URL=https://user:secret@git.test/agent.git\nMACRO_REPO_TOKEN=t\nMACRO_AGENT_USER_ID=macro|agent@example.com\nMACRO_AGENT_NAME=Fox\n",
    );
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::InvalidSetting(SettingsProblem::RepoUrlNotHttp))
    );
    case.write(
        "agent.env",
        "MACRO_REPO_URL=https://git.test/agent.git\nMACRO_REPO_TOKEN=t\nMACRO_AGENT_USER_ID=macro|agent\nMACRO_AGENT_NAME=Fox\n",
    );
    assert_eq!(
        case.boot(UNKNOWN).await,
        BootOutcome::Exit(BootExit::InvalidSetting(
            SettingsProblem::UserIdWithoutEmail
        ))
    );
    // Twice: agent.env isn't code, so a rollback can't help.
    assert_eq!(
        case.boot(PreviousExit::Exited { code: 78 }).await,
        BootOutcome::Exit(BootExit::SettingsWrongNotCode)
    );
}

#[test]
fn agent_env_values_are_unquoted_and_the_last_wins() {
    let parsed = settings::settings(
        "MACRO_REPO_URL=https://old.test/a.git\nMACRO_REPO_URL=\"https://git.test/agent.git\"\nMACRO_REPO_TOKEN=\"t\"\nMACRO_AGENT_USER_ID=\"macro|a@b\"\nMACRO_AGENT_NAME=\"Fox \\\"the\\\" \\\\ agent\"\n",
    )
    .unwrap();
    assert_eq!(
        parsed,
        settings::Settings {
            repo_url: "https://git.test/agent.git".to_owned(),
            email: "a@b".to_owned(),
            name: "Fox \"the\" \\ agent".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_child_past_its_deadline_is_killed() {
    let mut command = tokio::process::Command::new("sleep");
    command.arg("30");
    let started = std::time::Instant::now();
    let result = process::run(
        command,
        Limits {
            deadline: Duration::from_millis(200),
            max_output: 1024,
        },
    )
    .await;
    assert!(
        matches!(result, Err(ProcessError::TimedOut(_))),
        "{result:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test]
async fn output_past_the_limit_is_refused() {
    let mut command = tokio::process::Command::new("head");
    command.args(["-c", "100000", "/dev/zero"]);
    let result = process::run(
        command,
        Limits {
            deadline: Duration::from_secs(30),
            max_output: 1024,
        },
    )
    .await;
    assert!(
        matches!(result, Err(ProcessError::OutputTooLarge(1024))),
        "{result:?}"
    );
}

#[tokio::test]
async fn b7_changed_dependencies_roll_back_in_the_same_boot_to_last_good() {
    let case = Case::new();
    let good = head_of(&case.boot(UNKNOWN).await);
    case.write("state/last-good", &good);
    case.write(
        "workspace/package.json",
        r#"{"name":"agent","dependencies":{"zod":"4.4.3","left-pad":"1.3.0"}}"#,
    );
    case.ws(&["commit", "-qam", "self-edit: add left-pad"]);
    case.write("runtime/bun.lock", "lock v2\n");
    let head = head_of(&case.boot(PreviousExit::Exited { code: 75 }).await);
    assert_eq!(case.ws(&["show", "HEAD~1:package.json"]), TEMPLATE_PACKAGE);
    assert_eq!(
        case.ws(&["log", "-2", "--format=%s"]),
        format!(
            "chore(agent): adopt the image's bun.lock\nrevert(agent): roll back to last-good {}: its dependencies changed, and new packages need a new image",
            &good[..12]
        )
    );
    assert_eq!(case.state(&case.paths.boot_head), head);
}
