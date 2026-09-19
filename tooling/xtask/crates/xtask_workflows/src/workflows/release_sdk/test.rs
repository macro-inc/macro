use super::*;

fn rendered_yaml() -> String {
    release_sdk()
        .to_string()
        .expect("SDK release workflow should serialize")
}

#[test]
fn releases_from_main_when_the_manifest_version_rises() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("packages/sdk/package.json"));
    assert!(yaml.contains("runs-on: ubuntu-latest"));
    assert!(yaml.contains("id-token: write"));
    assert!(yaml.contains("contents: write"));
    assert!(yaml.contains("npm publish --access public"));
}

/// The release policy lives in TypeScript; the workflow only reads its outputs.
#[test]
fn delegates_the_release_decision_to_the_sdk_script() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("bun scripts/resolve-release.ts"));
    assert!(yaml.contains("steps.resolve.outputs.release == 'true'"));
}

#[test]
fn installs_dependencies_before_resolving() {
    let yaml = rendered_yaml();

    let install = yaml.find("bun install").expect("install step");
    let resolve = yaml
        .find("bun scripts/resolve-release.ts")
        .expect("resolve step");
    assert!(
        install < resolve,
        "the resolver imports semver, so dependencies must already be installed"
    );
}

#[test]
fn tags_only_after_a_successful_publish() {
    let yaml = rendered_yaml();

    let publish = yaml
        .find("npm publish --access public")
        .expect("publish step");
    let tag = yaml.find("git push origin").expect("tag step");
    assert!(
        publish < tag,
        "the release tag must be pushed after npm publish"
    );
}
