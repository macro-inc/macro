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
