use super::*;

fn rendered_yaml() -> String {
    publish_sdk()
        .to_string()
        .expect("SDK publish workflow should serialize")
}

#[test]
fn publishes_matching_tags_with_oidc_on_a_github_runner() {
    let yaml = rendered_yaml();

    assert!(yaml.contains(SDK_TAG_PATTERN));
    assert!(yaml.contains("runs-on: ubuntu-latest"));
    assert!(yaml.contains("id-token: write"));
    assert!(yaml.contains("npm publish --access public"));
    assert!(yaml.contains("tag version $version does not match package version $package_version"));
    assert!(yaml.contains("git merge-base --is-ancestor \"$GITHUB_SHA\" origin/main"));
}
