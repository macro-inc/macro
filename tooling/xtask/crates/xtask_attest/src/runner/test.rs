use std::collections::BTreeMap;

use tempfile::TempDir;

use super::*;

struct Fixture {
    _dir: TempDir,
    machine: Machine,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a directory");
        let workspace = dir.path().join("workspace");
        std::fs::create_dir_all(workspace.join("nested")).expect("a directory");
        let tmp = dir.path().join("tmp");
        std::fs::create_dir_all(&tmp).expect("a directory");
        let machine = Machine {
            workspace,
            scratch: dir.path().join("scratch"),
            tmp,
        };
        machine.fresh_scratch().expect("a scratch directory");
        Self { _dir: dir, machine }
    }

    /// Run the steps without a dev shell: the tests' scripts need only bash.
    fn run(&self, check: &Check) -> Outcome {
        self.machine.run_steps(check, None).expect("runs")
    }

    fn read(&self, file: &str) -> String {
        std::fs::read_to_string(self.machine.workspace.join(file)).expect("the step wrote the file")
    }
}

fn step(name: &str, run: &str) -> Step {
    Step {
        name: name.to_owned(),
        run: run.to_owned(),
        working_directory: None,
        pipefail: false,
        env: BTreeMap::new(),
    }
}

fn check(steps: Vec<Step>) -> Check {
    Check {
        id: "a/check".to_owned(),
        name: "A / check".to_owned(),
        fingerprint: "aaaa".to_owned(),
        triggers: vec![".".to_owned()],
        dev_shell: "default".to_owned(),
        env: BTreeMap::from([("FROM_THE_JOB".to_owned(), "job".to_owned())]),
        steps,
    }
}

#[test]
fn a_step_sees_the_checks_environment_its_own_and_what_earlier_steps_hand_on() {
    let fixture = Fixture::new();
    let mut second = step(
        "second",
        r#"echo "$FROM_THE_JOB|$STEP_ONLY|$LATER|$(added-tool)" > "$GITHUB_WORKSPACE/recorded""#,
    );
    second.env.insert("STEP_ONLY".to_owned(), "step".to_owned());

    let outcome = fixture.run(&check(vec![
        step(
            "first",
            r#"echo "LATER=set-by-a-step" >> "$GITHUB_ENV"
mkdir -p "$RUNNER_TEMP/tools" && printf '#!/bin/sh\necho from-the-added-path\n' > "$RUNNER_TEMP/tools/added-tool"
chmod +x "$RUNNER_TEMP/tools/added-tool" && echo "$RUNNER_TEMP/tools" >> "$GITHUB_PATH""#,
        ),
        second,
    ]));

    assert!(matches!(outcome, Outcome::Passed));
    assert_eq!(
        fixture.read("recorded"),
        "job|step|set-by-a-step|from-the-added-path\n"
    );
}

#[test]
fn a_step_runs_in_its_own_directory() {
    let fixture = Fixture::new();
    let mut nested = step("nested", "pwd > where");
    nested.working_directory = Some("nested".to_owned());

    assert!(matches!(fixture.run(&check(vec![nested])), Outcome::Passed));
    assert!(
        fixture
            .read("nested/where")
            .trim()
            .ends_with("/workspace/nested")
    );
}

#[test]
fn the_check_stops_at_the_first_failed_command() {
    let fixture = Fixture::new();

    let outcome = fixture.run(&check(vec![
        step("first", "true"),
        step(
            "breaks",
            "false\necho unreachable > \"$GITHUB_WORKSPACE/unreachable\"",
        ),
        step("never", "echo never > \"$GITHUB_WORKSPACE/never\""),
    ]));

    assert!(matches!(outcome, Outcome::Failed { step } if step == "breaks"));
    assert!(!fixture.machine.workspace.join("unreachable").exists());
    assert!(!fixture.machine.workspace.join("never").exists());
}

/// A runner runs a step that names bash with `-o pipefail`, and others
/// without: `false | true` fails only in the first.
#[test]
fn a_pipe_fails_the_step_only_where_a_runner_would_fail_it() {
    let fixture = Fixture::new();
    let mut strict = step("strict", "false | true");
    strict.pipefail = true;

    assert!(matches!(
        fixture.run(&check(vec![step("lenient", "false | true")])),
        Outcome::Passed
    ));
    assert!(matches!(
        fixture.run(&check(vec![strict])),
        Outcome::Failed { .. }
    ));
}

/// A runner fails the step; treated as a tool error it would stop the run
/// before the failure is recorded.
#[test]
fn a_step_that_leaves_a_block_open_fails() {
    let fixture = Fixture::new();

    let outcome = fixture.run(&check(vec![step(
        "half a block",
        r#"printf 'result<<EOF\nok\n' >> "$GITHUB_ENV""#,
    )]));

    assert!(matches!(outcome, Outcome::Failed { step } if step == "half a block"));
}

#[test]
fn a_step_does_not_see_the_callers_own_variables() {
    let fixture = Fixture::new();

    // `CARGO_MANIFEST_DIR` is set for this test by cargo, and is not passed on.
    let outcome = fixture.run(&check(vec![step(
        "isolated",
        r#"test -z "${CARGO_MANIFEST_DIR:-}""#,
    )]));

    assert!(matches!(outcome, Outcome::Passed));
}

/// A dev shell's environment makes a temporary directory whenever a shell
/// sources it and never removes it. Steps must leave none behind, and must
/// not lose the directory when the tool clears up: a server a step started
/// keeps using it.
#[test]
fn a_shell_leaves_no_directory_and_keeps_the_one_it_was_given() {
    let fixture = Fixture::new();
    let tmp = &fixture.machine.tmp;
    // What `nix print-dev-env` ends with, then what the tool appends.
    let mut environment = String::from(concat!(
        "export NIX_BUILD_TOP=\"$(mktemp -d -t nix-shell.XXXXXX)\"\n",
        "export TMP=\"$NIX_BUILD_TOP\"\n",
        "export TMPDIR=\"$NIX_BUILD_TOP\"\n",
    ));
    environment.push_str(&one_temporary_directory(tmp));
    let dev_env = fixture.machine.scratch.join("dev-env");
    std::fs::write(&dev_env, environment).expect("writes");

    let outcome = fixture
        .machine
        .run_steps(
            &check(vec![step(
                "starts shells and makes a temporary file",
                r#"bash -c 'bash -c true'; mktemp > "$GITHUB_WORKSPACE/made""#,
            )]),
            Some(&dev_env),
        )
        .expect("runs");

    assert!(matches!(outcome, Outcome::Passed));
    let made = fixture.read("made");
    assert_eq!(
        std::path::Path::new(made.trim()).parent(),
        Some(tmp.as_path())
    );
    let left: Vec<_> = std::fs::read_dir(tmp)
        .expect("lists")
        .map(|entry| entry.expect("an entry").file_name())
        .filter(|name| name.to_string_lossy().starts_with("nix-shell."))
        .collect();
    assert!(left.is_empty(), "{left:?}");

    fixture.machine.clear();
    assert!(tmp.exists() && !fixture.machine.scratch.exists());
}
