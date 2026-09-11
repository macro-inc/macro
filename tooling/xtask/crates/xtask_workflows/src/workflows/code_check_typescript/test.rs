use super::*;

#[test]
fn covers_ai_editing_worker_and_shared_packages() {
    let yaml = code_check_typescript().to_string().expect("workflow yaml");
    assert!(yaml.contains("services/ai-editing-worker/**"));
    assert!(yaml.contains("packages/lexical-core/**"));
    assert!(yaml.contains("packages/email-renderer/**"));
    assert!(yaml.contains("tooling/scripts/check-typescript.sh"));
    assert!(yaml.contains("--biome"));
    assert!(yaml.contains("--tsc"));
}
