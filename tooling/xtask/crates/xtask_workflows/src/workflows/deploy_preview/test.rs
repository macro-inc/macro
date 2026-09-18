use super::*;

#[test]
fn preview_build_uses_remote_sccache_and_wasm_cache() {
    let yaml = deploy_preview().to_string().expect("workflow yaml");
    let job = yaml.split("\n  deploy:\n").nth(1).expect("deploy job");
    assert!(
        job.contains("nsc cache sccache setup --cache_name web-ci"),
        "preview must use the shared web-ci remote sccache: {job}"
    );
    assert!(
        job.contains(".wasm-pack"),
        "preview must persist wasm-pack's wasm-opt cache: {job}"
    );
    assert!(
        job.contains("just build-dev"),
        "preview still builds the vite bundle: {job}"
    );
}
