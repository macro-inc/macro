use super::*;

#[test]
fn deploy_build_uses_remote_sccache_and_wasm_cache() {
    let yaml = deploy_web_app().to_string().expect("workflow yaml");
    let job = yaml
        .split("\n  build-deploy:\n")
        .nth(1)
        .expect("build-deploy job");
    assert!(
        job.contains("nsc cache sccache setup --cache_name web-ci"),
        "deploy must use the shared web-ci remote sccache: {job}"
    );
    assert!(
        job.contains(".wasm-pack"),
        "deploy must persist wasm-pack's wasm-opt cache: {job}"
    );
    assert!(
        job.contains("just build-${{ inputs.environment }}"),
        "deploy still builds via just: {job}"
    );
}
