use super::*;

#[test]
fn builds_the_commit_deploy_on_push_built() {
    let workflow: serde_yaml::Value =
        serde_yaml::from_str(&push_local_stack_binaries().to_string().unwrap()).unwrap();
    assert_eq!(workflow["permissions"]["actions"], "read");
    let steps = workflow["jobs"]["push"]["steps"].as_sequence().unwrap();
    assert_eq!(steps[0]["id"], "commit");
    assert_eq!(steps[0]["continue-on-error"], true);
    assert_eq!(
        steps[1]["with"]["ref"],
        "${{ steps.commit.outputs.sha || github.sha }}"
    );
    let build = steps
        .iter()
        .find(|step| step["name"] == "Build local stack binaries")
        .unwrap();
    assert!(
        build["run"]
            .as_str()
            .unwrap()
            .contains(&format!("--max-jobs {MAX_JOBS}"))
    );
}

#[test]
fn commit_script_scenarios() {
    let output = std::process::Command::new("node")
        .args(["--test", "local_stack_commit.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .output()
        .expect("run the commit scenarios with Node");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
