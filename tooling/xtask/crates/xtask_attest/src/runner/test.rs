use std::path::Path;

use tempfile::TempDir;

use super::*;

const WORKFLOW: &str = r#"
env:
  WORKFLOW_WIDE: from-the-workflow
jobs:
  path-check:
    outputs:
      should_run: ${{ steps.filter.outputs.should_run }}
      packages: ${{ steps.pick.outputs.packages }}
    steps:
    - uses: actions/checkout@abc
    - id: filter
      uses: dorny/paths-filter@abc
      with:
        filters: |
          should_run:
            - 'crates/**'
    - name: Configure the cache
      run: exit 1
    - id: pick
      name: pick packages
      if: steps.filter.outputs.should_run == 'true'
      run: echo "packages=email documents" >> "$GITHUB_OUTPUT"
      shell: bash
  check:
    env:
      PACKAGES: ${{ needs.path-check.outputs.packages }}
      CACHE: /home/runner/.cache/tool
    steps:
    - name: Configure the cache
      run: exit 1
    - name: record
      run: |
        echo "$PACKAGES|$WORKFLOW_WIDE|$CACHE|$STEP_ONLY" > "$GITHUB_WORKSPACE/recorded"
        echo "LATER=set-by-a-step" >> "$GITHUB_ENV"
        mkdir -p "$RUNNER_TEMP/tools" && printf '#!/bin/sh\necho from-the-added-path\n' > "$RUNNER_TEMP/tools/added-tool"
        chmod +x "$RUNNER_TEMP/tools/added-tool" && echo "$RUNNER_TEMP/tools" >> "$GITHUB_PATH"
      env:
        STEP_ONLY: ${{ needs.path-check.outputs.should_run }}
    - name: skipped by its condition
      if: needs.path-check.outputs.should_run != 'true'
      run: exit 1
    - name: later
      run: echo "$LATER $(added-tool)" > later
      working-directory: nested
  shards:
    strategy:
      matrix:
        shard: [1, 2, 3]
    steps:
    - name: shard
      run: echo "${{ matrix.shard }}/3" >> "$GITHUB_WORKSPACE/shards"
  composite:
    steps:
    - name: Setup
      uses: ./.github/actions/setup
      with:
        flavour: spicy
    - name: after
      run: test "$FROM_ACTION" = spicy-mild
  fails:
    steps:
    - name: first
      run: "true"
    - name: breaks
      run: |
        false
        echo unreachable > "$GITHUB_WORKSPACE/unreachable"
    - name: never
      run: echo never > "$GITHUB_WORKSPACE/never"
  unknown-action:
    steps:
    - uses: someone/lints@v1
  services:
    services:
      postgres:
        image: postgres
    steps:
    - name: test
      run: "true"
"#;

const ACTION: &str = r#"
inputs:
  flavour:
    default: plain
  second:
    default: mild
runs:
  using: composite
  steps:
  - name: say
    shell: bash
    run: echo "FROM_ACTION=${{ inputs.flavour }}-${{ inputs.second }}" >> "$GITHUB_ENV"
  - name: not this time
    if: inputs.flavour == 'plain'
    shell: bash
    run: exit 1
"#;

struct Fixture {
    _root: TempDir,
    manifest: Manifest,
    workspace: PathBuf,
    scratch: PathBuf,
    runner_home: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = TempDir::new().expect("temp dir");
        let at = |name: &str| root.path().join(name);
        for directory in [
            "workspace/nested",
            "workspace/.github/actions/setup",
            "scratch",
            "home",
        ] {
            std::fs::create_dir_all(at(directory)).expect("create directory");
        }
        std::fs::write(at("workspace/.github/actions/setup/action.yml"), ACTION)
            .expect("write action");
        // An empty dev shell environment: the tests need no pinned tools, and
        // the machine reuses the file instead of asking Nix for it.
        std::fs::write(at("scratch/nix-dev-env-default"), "").expect("write dev env");

        let manifest = Manifest {
            status_prefix: "attested/".to_owned(),
            caller: "pr-ci.yml".to_owned(),
            caller_start_job: "start".to_owned(),
            selector_job: "path-check".to_owned(),
            filter_action: "dorny/paths-filter".to_owned(),
            runner_steps: vec!["Configure the cache".to_owned()],
            runner_actions: vec!["actions/checkout".to_owned()],
            checks: Vec::new(),
        };
        Fixture {
            manifest,
            workspace: at("workspace"),
            scratch: at("scratch"),
            runner_home: at("home"),
            _root: root,
        }
    }

    fn machine(&self, changed: &[&str]) -> Machine<'_> {
        Machine {
            manifest: &self.manifest,
            workspace: self.workspace.clone(),
            scratch: self.scratch.clone(),
            runner_home: self.runner_home.clone(),
            github: BTreeMap::from([("workspace", self.workspace.display().to_string())]),
            changed_files: changed.iter().map(|path| (*path).to_owned()).collect(),
        }
    }

    fn read(&self, file: &str) -> String {
        std::fs::read_to_string(self.workspace.join(file)).expect("the step wrote the file")
    }
}

fn workflow() -> Yaml {
    serde_yaml::from_str(WORKFLOW).expect("fixture parses")
}

fn passed(result: JobResult) -> Outputs {
    match result {
        JobResult::Passed(outputs) => outputs,
        JobResult::Failed { step } => panic!("`{step}` failed"),
    }
}

fn steps(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn the_selector_job_turns_changed_paths_into_outputs() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&["crates/email/src/lib.rs"]);

    let outputs = passed(
        machine
            .run_job(
                &workflow(),
                "path-check",
                &Plan::EveryStep,
                &BTreeMap::new(),
            )
            .expect("runs"),
    );

    assert_eq!(outputs["should_run"], "true");
    assert_eq!(outputs["packages"], "email documents");
}

#[test]
fn a_step_whose_condition_is_false_does_not_run() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&["docs/readme.md"]);

    let outputs = passed(
        machine
            .run_job(
                &workflow(),
                "path-check",
                &Plan::EveryStep,
                &BTreeMap::new(),
            )
            .expect("runs"),
    );

    assert_eq!(outputs["should_run"], "false");
    assert_eq!(outputs["packages"], "");
}

#[test]
fn filters_only_decides_outputs_without_running_a_step() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&["crates/email/src/lib.rs"]);

    let outputs = passed(
        machine
            .run_job(
                &workflow(),
                "path-check",
                &Plan::FiltersOnly,
                &BTreeMap::new(),
            )
            .expect("runs"),
    );

    assert_eq!(outputs["should_run"], "true");
    assert_eq!(outputs["packages"], "");
}

#[test]
fn a_job_sees_needs_environment_and_what_earlier_steps_hand_on() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&[]);
    let needs = BTreeMap::from([(
        "path-check".to_owned(),
        Outputs::from([
            ("should_run".to_owned(), "true".to_owned()),
            ("packages".to_owned(), "email documents".to_owned()),
        ]),
    )]);

    passed(
        machine
            .run_job(
                &workflow(),
                "check",
                &Plan::Steps(&steps(&["record", "skipped by its condition", "later"])),
                &needs,
            )
            .expect("runs"),
    );

    let home = fixture.runner_home.display();
    assert_eq!(
        fixture.read("recorded").trim(),
        format!("email documents|from-the-workflow|{home}/.cache/tool|true")
    );
    assert_eq!(
        fixture.read("nested/later").trim(),
        "set-by-a-step from-the-added-path"
    );
}

#[test]
fn a_matrix_job_runs_every_row() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&[]);

    passed(
        machine
            .run_job(
                &workflow(),
                "shards",
                &Plan::Steps(&steps(&["shard"])),
                &BTreeMap::new(),
            )
            .expect("runs"),
    );

    assert_eq!(fixture.read("shards"), "1/3\n2/3\n3/3\n");
}

#[test]
fn a_composite_action_of_the_repository_runs_with_its_inputs() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&[]);

    passed(
        machine
            .run_job(
                &workflow(),
                "composite",
                &Plan::Steps(&steps(&["after"])),
                &BTreeMap::new(),
            )
            .expect("runs"),
    );
}

#[test]
fn the_job_stops_at_the_first_failed_command() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&[]);

    let result = machine
        .run_job(
            &workflow(),
            "fails",
            &Plan::Steps(&steps(&["first", "breaks", "never"])),
            &BTreeMap::new(),
        )
        .expect("runs");

    assert!(matches!(result, JobResult::Failed { step } if step == "breaks"));
    assert!(!Path::new(&fixture.workspace.join("unreachable")).exists());
    assert!(!Path::new(&fixture.workspace.join("never")).exists());
}

/// A step the manifest doesn't list was added to the job after the manifest
/// was generated; attesting without it would attest a different job.
#[test]
fn refuses_a_job_with_a_step_the_check_does_not_list() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&[]);

    let result = machine.run_job(
        &workflow(),
        "fails",
        &Plan::Steps(&steps(&["first"])),
        &BTreeMap::new(),
    );

    assert!(result.is_err());
    assert!(!Path::new(&fixture.workspace.join("never")).exists());
}

#[test]
fn refuses_what_a_machine_cannot_stand_in_for() {
    let fixture = Fixture::new();
    let machine = fixture.machine(&[]);
    let none = BTreeMap::new();

    assert!(
        machine
            .run_job(&workflow(), "unknown-action", &Plan::EveryStep, &none)
            .is_err()
    );
    assert!(
        machine
            .run_job(&workflow(), "services", &Plan::EveryStep, &none)
            .is_err()
    );
}

/// The digest `accept_attested_checks.test.ts` pins for the same outputs.
#[test]
fn the_inputs_digest_is_the_one_path_check_computes() {
    let outputs = Outputs::from([
        ("should_run".to_owned(), "true".to_owned()),
        ("rust_packages".to_owned(), "email documents".to_owned()),
        ("unread".to_owned(), "ignored".to_owned()),
    ]);

    assert_eq!(
        inputs_digest(&steps(&["should_run", "rust_packages"]), &outputs),
        "705c3b0a1adf4955"
    );
    assert_eq!(
        inputs_digest(&steps(&["graphql_schema"]), &Outputs::new()),
        inputs_digest(
            &steps(&["graphql_schema"]),
            &Outputs::from([("graphql_schema".to_owned(), String::new())])
        )
    );
}
