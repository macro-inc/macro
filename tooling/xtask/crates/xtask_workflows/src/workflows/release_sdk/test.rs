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

#[test]
fn skips_quietly_when_the_version_is_already_published() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("is already published; nothing to release."));
    assert!(yaml.contains("release=false"));
    assert!(yaml.contains("steps.resolve.outputs.release == 'true'"));
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
