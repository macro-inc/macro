use super::*;

#[test]
fn deploy_publishes_the_marketing_build_through_the_website_stack() {
    let yaml = crate::workflows::render_patched(deploy_website, patch).expect("workflow yaml");
    let check = |needle: &str| assert!(yaml.contains(needle), "missing `{needle}`:\n{yaml}");
    [
        "lfs: 'true'",
        "working-directory: apps/marketing",
        "run: bun run build",
        "'https://macro.com'",
        "work-dir: ./infra/stacks/website",
        "stack-name: macro-inc/${{ matrix.environment }}",
        // Manual dispatch can target dev, prod, or both, one leg at a time.
        "- both",
        r#"inputs.environment == 'both' && '["dev","prod"]'"#,
        "max-parallel: 1",
        "group: deploy-website-${{ matrix.environment }}",
    ]
    .into_iter()
    .for_each(check);

    let build = yaml.find("run: bun run build").expect("build step");
    let deploy = yaml.find("command: up").expect("pulumi up");
    assert!(
        build < deploy,
        "the site must be built before pulumi syncs it"
    );
}
