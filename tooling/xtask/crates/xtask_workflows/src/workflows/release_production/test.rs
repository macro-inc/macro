use super::*;

fn rendered(
    build: fn() -> Workflow,
    patch: fn(&mut serde_yaml::Value) -> Result<()>,
) -> serde_yaml::Value {
    serde_yaml::from_str(&crate::workflows::render_patched(build, patch).expect("workflow yaml"))
        .expect("parse workflow")
}

fn release() -> serde_yaml::Value {
    rendered(release_production, patch)
}

fn steps_using<'a>(job: &'a serde_yaml::Value, action: &str) -> Vec<&'a serde_yaml::Value> {
    job["steps"]
        .as_sequence()
        .expect("steps")
        .iter()
        .filter(|step| {
            step["uses"]
                .as_str()
                .is_some_and(|uses| uses.starts_with(&format!("{action}@")))
        })
        .collect()
}

/// The release builds with the inputs, secrets and artifact the shared build
/// workflow defines, and with the keys its own build job used.
#[test]
fn the_web_app_builds_through_the_shared_build_workflow() {
    let release = release();
    let jobs = &release["jobs"];
    let build = &jobs["build"];
    assert_eq!(
        build["uses"].as_str(),
        Some("./.github/workflows/build_web_app.yml")
    );
    assert_eq!(build["with"]["environment"].as_str(), Some("prod"));
    assert!(
        build["needs"].is_null(),
        "the build overlaps the backend deploy"
    );

    let shared = rendered(build_web_app::build_web_app, build_web_app::patch);
    let secrets: Vec<&str> = shared["on"]["workflow_call"]["secrets"]
        .as_mapping()
        .expect("secrets")
        .keys()
        .filter_map(serde_yaml::Value::as_str)
        .collect();
    assert_eq!(secrets, ["SEGMENT_WRITE_KEY", "POSTHOG_API_KEY"]);
    assert_eq!(
        build["secrets"]["SEGMENT_WRITE_KEY"].as_str(),
        Some("${{ secrets.SEGMENT_WRITE_KEY_PRODUCTION }}")
    );
    assert_eq!(
        build["secrets"]["POSTHOG_API_KEY"].as_str(),
        Some("${{ secrets.POSTHOG_API_KEY }}")
    );

    for job in ["deploy", "upload"] {
        let downloads: Vec<&str> = steps_using(&jobs[job], "actions/download-artifact")
            .into_iter()
            .filter_map(|step| step["with"]["name"].as_str())
            .collect();
        assert_eq!(downloads, ["web-app-dist-prod"], "{job}");
        assert!(
            jobs[job]["needs"]
                .as_sequence()
                .expect("needs")
                .contains(&"build".into()),
            "{job}"
        );
    }

    // The release kept its build a week, so its jobs can be re-run later.
    let upload = steps_using(&shared["jobs"]["build"], "actions/upload-artifact");
    assert_eq!(
        upload[0]["with"]["retention-days"].as_str(),
        Some("${{ inputs.environment == 'prod' && 7 || 1 }}")
    );
}

/// Every step of the release's own jobs names its prod target, since a
/// release run has no `inputs`.
#[test]
fn the_release_jobs_name_prod_themselves() {
    let release = release();
    for job in ["deploy", "upload"] {
        let job = &release["jobs"][job];
        let yaml = serde_yaml::to_string(job).expect("job yaml");
        assert!(!yaml.contains("inputs."), "{yaml}");
    }
    let deploy = &release["jobs"]["deploy"];
    let pulumi = steps_using(deploy, "pulumi/actions");
    assert_eq!(
        pulumi[0]["with"]["stack-name"].as_str(),
        Some("macro-inc/prod")
    );
    assert!(
        deploy["steps"]
            .as_sequence()
            .expect("steps")
            .iter()
            .any(|step| step["run"].as_str() == Some("bun run ddupload:prod")),
        "{deploy:?}"
    );
}

/// Like the build, the web deploy mounts only the Nix store and Bun's package
/// cache from the volume pull requests write, and seeds nothing from the HTTP
/// cache they write.
#[test]
fn the_web_deploy_mounts_only_nix_and_bun() {
    let release = release();
    let mounts = steps_using(
        &release["jobs"]["deploy"],
        "namespacelabs/nscloud-cache-action",
    );
    assert_eq!(mounts.len(), 1, "{mounts:?}");
    assert_eq!(mounts[0]["with"]["cache"].as_str(), Some("nix"));
    assert_eq!(
        mounts[0]["with"]["path"].as_str(),
        Some(vars::BUN_CACHE_VOLUME_DIR)
    );
    assert!(
        release["jobs"]["deploy"]["steps"]
            .as_sequence()
            .expect("steps")
            .iter()
            .all(|step| step["with"]["seed-cache"].is_null())
    );
}
