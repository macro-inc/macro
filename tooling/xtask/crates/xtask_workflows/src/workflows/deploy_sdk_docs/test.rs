use super::*;

#[test]
fn production_docs_only_deploy_from_main_after_validation() {
    let yaml = deploy_sdk_docs().to_string().expect("workflow yaml");
    assert!(yaml.contains("github.ref == 'refs/heads/main'"));
    assert!(yaml.contains("contents: read"));
    assert!(!yaml.contains("pull_request"));
    assert!(yaml.contains("packages/sdk-docs/**"));
    assert!(yaml.contains("packages/sdk/**"));
    assert!(yaml.contains("bun install --frozen-lockfile"));
    assert!(yaml.find("bun run test").unwrap() < yaml.find("bun run docs:deploy").unwrap());
    assert!(yaml.contains("secrets.CLOUDFLARE_API_TOKEN"));
}
