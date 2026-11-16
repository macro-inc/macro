use super::*;

fn rendered_yaml() -> String {
    sdk_ocaml_check()
        .to_string()
        .expect("OCaml SDK check workflow should serialize")
}

/// A spec change on main must fail here when generated/ was not regenerated.
#[test]
fn runs_in_pr_ci_and_on_main_for_spec_changes() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("workflow_call:"));
    assert!(yaml.contains("push:"));
    assert!(yaml.contains("packages/sdk/specs/**"));
    assert!(yaml.contains("packages/sdk-ocaml/**"));
}

#[test]
fn builds_and_tests_in_the_package_nix_shell() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("setup-nix"));
    assert!(yaml.contains("nix-shell packages/sdk-ocaml/shell.nix"));
    assert!(yaml.contains("dune build && dune test"));
}

#[test]
fn runs_the_wasm_libraries_tests() {
    let yaml = rendered_yaml();

    assert!(
        yaml.contains("--profile wasm --build-dir _build_wasm @fetch/runtest @code_mode/runtest")
    );
    assert!(yaml.contains("packages/sdk/generated/*/sdk.gen.ts"));
}

#[test]
fn checks_the_code_mode_bundle() {
    let yaml = rendered_yaml();

    assert!(yaml.contains(".#checks.x86_64-linux.code-mode-ocaml-sample"));
    assert!(yaml.contains("nix/cloud-storage.nix"));
}
