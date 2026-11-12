use super::*;

#[test]
fn build_uses_remote_sccache_and_wasm_cache() {
    let yaml = build_web_app().to_string().expect("workflow yaml");
    let job = yaml.split("\n  build:\n").nth(1).expect("build job");
    assert!(
        job.contains("nsc cache sccache setup --cache_name web-ci"),
        "build must use the shared web-ci remote sccache: {job}"
    );
    let configure = job
        .find("nsc cache sccache setup")
        .expect("remote cache configuration");
    let start = job
        .find("run: sccache --start-server")
        .expect("start the server in a separate step with the exported credentials");
    let build_command = job.find("just build-").expect("web build command");
    assert!(configure < start && start < build_command);
    assert!(
        job.contains(".wasm-pack"),
        "build must persist wasm-pack's wasm-opt cache: {job}"
    );
    assert!(
        job.contains("just build-${{ inputs.environment }}"),
        "build still runs via just: {job}"
    );
}

#[test]
fn build_reuses_wasm_packages_only_from_the_actions_cache() {
    let yaml = build_web_app().to_string().expect("workflow yaml");
    let job = yaml.split("\n  build:\n").nth(1).expect("build job");
    assert!(
        job.contains(&format!(
            "WASM_PKG_CACHE_DIR: {}",
            vars::DEPLOY_WASM_PKG_CACHE_DIR
        )),
        "deploys reuse unchanged wasm packages: {job}"
    );
    // PR jobs write the Namespace HTTP cache and the cache volume; a deploy
    // must read neither.
    assert!(!job.contains("WASM_PKG_HTTP_CACHE"), "{job}");
    assert_eq!(
        job.matches(vars::DEPLOY_WASM_PKG_CACHE_DIR).count(),
        3,
        "the package dir is in the job env and the cache steps, never on the volume: {job}"
    );

    let restore = job.find("actions/cache/restore@").expect("restore step");
    let wasm = job.find("just build-wasm").expect("wasm packages step");
    let save = job.find("actions/cache/save@").expect("save step");
    let build = job
        .find("just build-${{ inputs.environment }}")
        .expect("app build");
    assert!(
        restore < wasm && wasm < save && save < build,
        "packages are saved before the app build, so a cancelled run keeps them: {job}"
    );
    assert!(
        job.contains("if: steps.wasm.outputs.key != steps.restore-wasm.outputs.cache-matched-key"),
        "an unchanged set is not saved again: {job}"
    );
}
