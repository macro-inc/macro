use super::*;

#[test]
fn the_analyzers_answers_parse_and_anything_else_is_refused() {
    let ok = br#"{"status":"ok","operations":[{"service":"storage","operation":"create_task_handler","path":"Macro_sdk.Storage.create_task_handler","method":"POST","route":"/documents/create_task","rivals":[{"service":"storage","route":"/documents/{}"}],"locations":[]}]}"#;
    assert_eq!(
        analysis(ok, "main.ml"),
        Some(Analysis::Calls(
            [SdkCall {
                operation: SdkOperation {
                    service: "storage".into(),
                    operation_id: "create_task_handler".into(),
                },
                method: "POST".into(),
                route: "/documents/create_task".into(),
                rivals: vec![SdkRoute {
                    service: "storage".into(),
                    route: "/documents/{}".into(),
                }],
            }]
            .into()
        ))
    );
    let cannot = br#"{"status":"cannot_analyze","reasons":[{"message":"belongs to Obj","location":{"file":"main.ml","line":5,"column":2}}]}"#;
    assert_eq!(
        analysis(cannot, "main.ml"),
        Some(Analysis::CannotAnalyze(vec![AnalysisReason {
            message: "belongs to Obj".into(),
            line: 5,
            column: 3,
        }]))
    );
    assert_eq!(
        analysis(br#"{"status":"cannot_analyze","reasons":[]}"#, "main.ml"),
        None
    );
    assert_eq!(analysis(br#"{"status":"maybe"}"#, "main.ml"), None);
    assert_eq!(analysis(b"not json", "main.ml"), None);
}

#[test]
fn a_program_that_does_not_parse_answers_located_diagnostics() {
    let answer = br#"{"status":"diagnostics","diagnostics":[{"message":"Unexpected token","location":{"line":2,"column":4}},{"message":"Unsupported syntax"}]}"#;
    assert_eq!(
        analysis(answer, "main.js"),
        Some(Analysis::Diagnostics(vec![
            Diagnostic {
                file: Some("main.js".into()),
                message: "main.js:2:5: Unexpected token".into(),
            },
            Diagnostic {
                file: Some("main.js".into()),
                message: "main.js: Unsupported syntax".into(),
            },
        ]))
    );
    assert_eq!(
        analysis(br#"{"status":"diagnostics","diagnostics":[]}"#, "main.js"),
        None
    );
}
