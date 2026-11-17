use super::*;

fn diagnostics(error: CompileError) -> Vec<Diagnostic> {
    match error {
        CompileError::Diagnostics(diagnostics) => diagnostics,
        other => panic!("expected diagnostics, got {other:?}"),
    }
}

#[test]
fn compiler_errors_keep_their_text_and_end_with_their_location() {
    let output = b"File \"main.ml\", line 2, characters 20-21:\n2 | let unused () = let q = 2 in 3\n                        ^\nWarning 26 [unused-var]: unused variable q.\nFile \"main.ml\", lines 4-5, characters 8-9:\n4 | let x = y\n            ^\nError: Unbound value y\n";
    assert_eq!(
        diagnostics(compiler_diagnostics(output, Path::new("/nix/store/bundle"))),
        [Diagnostic {
            file: Some("main.ml".into()),
            message: "4 | let x = y\n            ^\nError: Unbound value y\n    at main.ml:4:9"
                .into(),
        }]
    );
}

#[test]
fn an_error_outside_the_program_names_no_file() {
    let output = b"File \"/nix/store/bundle/cmi/macro_sdk.cmi\", line 1, characters 0-0:\nError: The files /nix/store/bundle/cmi/code_mode.cmi and main.cmo make inconsistent assumptions\nError: Some other problem\n";
    let found = diagnostics(compiler_diagnostics(output, Path::new("/nix/store/bundle")));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].file, None);
    assert!(!found[0].message.contains("/nix/store"), "{found:?}");
    assert!(matches!(
        compiler_diagnostics(b"Warning only\n", Path::new("/nix/store/bundle")),
        CompileError::Internal
    ));
}

#[test]
fn policy_findings_become_located_errors() {
    let output = b"main.ml:1:1: An external declaration is not allowed in code-mode programs\nmain.ml:3:9: Obj is not allowed in code-mode programs\n";
    assert_eq!(
        diagnostics(policy_diagnostics(output)),
        [
            Diagnostic {
                file: Some("main.ml".into()),
                message: "Error: An external declaration is not allowed in code-mode programs\n    at main.ml:1:1".into(),
            },
            Diagnostic {
                file: Some("main.ml".into()),
                message: "Error: Obj is not allowed in code-mode programs\n    at main.ml:3:9".into(),
            },
        ]
    );
    assert!(matches!(policy_diagnostics(b""), CompileError::Internal));
}
