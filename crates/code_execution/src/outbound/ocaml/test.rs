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

#[test]
fn only_the_runtimes_own_fatal_lines_mean_out_of_memory() {
    assert!(out_of_memory(b"Fatal error: exception Out_of_memory\n"));
    assert!(out_of_memory(
        b"some progress\nterminate called after throwing an instance of 'std::bad_alloc'\n  what():  std::bad_alloc\n"
    ));
    assert!(out_of_memory(
        b"Fatal error: allocation failure during minor GC\n"
    ));
    // A type error on a line that holds the markers keeps its own error.
    let type_error = b"File \"main.ml\", line 1, characters 14-29:\n1 | let x : int = \"Out of memory\"\n                  ^^^^^^^^^^^^^^^\nError: This constant has type string but an expression was expected of type int\n";
    assert!(!out_of_memory(type_error));
    let failwith = b"File \"main.ml\", line 2, characters 0-30:\n2 | failwith \"Fatal error: allocation failure std::bad_alloc\" + 1\nError: This expression has type 'a but an expression was expected of type int\n";
    assert!(!out_of_memory(failwith));
    assert_eq!(
        diagnostics(compiler_diagnostics(
            type_error,
            Path::new("/nix/store/bundle")
        ))[0]
            .file,
        Some("main.ml".into())
    );
}

#[test]
fn the_analyzers_answers_parse_and_anything_else_is_refused() {
    let ok = br#"{"status":"ok","operations":[{"service":"storage","operation":"create_task_handler","path":"Macro_sdk.Storage.create_task_handler","method":"POST","route":"/documents/create_task","locations":[]}]}"#;
    assert_eq!(
        analysis(ok),
        Some(Analysis::Calls(
            [SdkCall {
                operation: SdkOperation {
                    service: "storage".into(),
                    operation_id: "create_task_handler".into(),
                },
                method: "POST".into(),
                route: "/documents/create_task".into(),
            }]
            .into()
        ))
    );
    let cannot = br#"{"status":"cannot_analyze","reasons":[{"message":"belongs to Obj","location":{"file":"main.ml","line":5,"column":2}}]}"#;
    assert_eq!(
        analysis(cannot),
        Some(Analysis::CannotAnalyze(vec![AnalysisReason {
            message: "belongs to Obj".into(),
            line: 5,
            column: 3,
        }]))
    );
    assert_eq!(
        analysis(br#"{"status":"cannot_analyze","reasons":[]}"#),
        None
    );
    assert_eq!(analysis(br#"{"status":"maybe"}"#), None);
    assert_eq!(analysis(b"not json"), None);
}
