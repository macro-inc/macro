use super::*;

#[test]
fn editor_artifacts_precede_typecheck_and_every_unit_shard() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let producer = job(&yaml, "editor-wasm", "typescript");
    assert!(producer.contains("just --justfile apps/web/justfile build-document-session-wasm"));
    assert!(producer.contains("just build-lexical-conformance-wasm"));
    assert!(producer.contains(
        "git diff --exit-code -- packages/collaboration/src/session/wasm.generated.d.ts"
    ));
    assert!(producer.contains("name: editor-wasm"));
    assert!(producer.contains("selection-browser-test/wasm"));
    assert!(producer.contains("cp -R apps/web/src/lib/core/document-session/wasm/."));
    for consumer in [
        job(&yaml, "typescript", "generated-code"),
        job(&yaml, "test", "functional"),
    ] {
        assert!(consumer.contains("- editor-wasm"));
        assert!(consumer.contains("name: editor-wasm"));
        let restore = consumer
            .find("tar -xf target/ci-editor-wasm/ci-editor-wasm.tar")
            .expect("restore");
        let check = consumer
            .find("name: Run checks")
            .or_else(|| consumer.find("name: Test\n"))
            .expect("consumer check");
        assert!(
            restore < check,
            "real artifacts must exist before consumers start"
        );
    }
    let status = yaml
        .split("\n  status-check:\n")
        .nth(1)
        .expect("status job");
    assert!(status.contains("- editor-wasm"));
    assert!(status.contains("needs.editor-wasm.result }}\" == \"failure"));
    assert!(status.contains("needs.editor-wasm.result }}\" == \"cancelled"));
}
