use super::*;
use std::path::Path;

fn repository_file(path: &str) -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read_to_string(root.join(path)).unwrap()
}

/// The stack names its alias `alias/<pulumi project>-<stack>`; the service
/// must compute the same name for the `dev` and `prod` stacks.
#[test]
fn deployed_aliases_match_the_stack() {
    let service = repository_file("infra/stacks/whatsapp-session-service/service.ts");
    assert!(service.contains("const BASE_NAME = pulumi.getProject();"));
    assert!(service.contains("name: `alias/${BASE_NAME}-${stack}`,"));
    let project = repository_file("infra/stacks/whatsapp-session-service/Pulumi.yaml");
    assert!(
        project
            .lines()
            .any(|line| line == "name: whatsapp-session-service")
    );
    assert_eq!(
        SessionKmsKey::for_environment(Environment::Develop),
        "alias/whatsapp-session-service-dev"
    );
    assert_eq!(
        SessionKmsKey::for_environment(Environment::Production),
        "alias/whatsapp-session-service-prod"
    );
}

/// `xtask_local` creates the local alias in LocalStack.
#[test]
fn the_local_alias_is_the_one_localstack_creates() {
    let resources = repository_file("tooling/xtask/crates/xtask_local/src/local/resources.rs");
    assert!(resources.contains(&format!(
        "pub const WHATSAPP_SESSION_KMS_ALIAS: &str = \"{}\";",
        SessionKmsKey::for_environment(Environment::Local)
    )));
}
