//! The analyzer through the real Deno process and the embedded bundle. The
//! evasion corpus is the one the bundle's own tests run against the
//! interpreter (`packages/code-mode-sdk`); here it checks that Rust gets the
//! same answer and maps each path to its registry key.

use super::*;
use std::collections::BTreeSet;

async fn analyzer(concurrency: usize) -> (tempfile::TempDir, JsToolsAnalyzer) {
    let root = tempfile::tempdir().unwrap();
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    let analyzer = JsToolsAnalyzer::new(binary, root.path().to_owned(), concurrency, 64 * 1024)
        .await
        .unwrap();
    (root, analyzer)
}

/// The registry keys an answer lists, or why it isn't a list.
type Keys = Result<BTreeSet<String>, String>;

fn keys(analysis: Analysis) -> Keys {
    match analysis {
        Analysis::Calls(calls) => Ok(calls
            .into_iter()
            .map(|call| call.operation.to_string())
            .collect()),
        Analysis::CannotAnalyze(_) => Err("cannot_analyze".into()),
        Analysis::Diagnostics(_) => Err("diagnostics".into()),
    }
}

const CREATE: &str = "storage.create_task_handler";
const READ: &str = "storage.get_document_markdown";
const DELETE: &str = "storage.delete_document";

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn calls_map_to_registry_keys_with_their_routes() {
    let (_root, analyzer) = analyzer(1).await;
    let analysis = analyzer
        .may_call(
            "const task = await tools.storage.create_task_handler({ body: { taskName: 'x' } })\n\
             return await tools.storage.get_document_markdown({ path: { document_id: task.documentId } })",
        )
        .await
        .unwrap();
    let Analysis::Calls(calls) = analysis else {
        panic!("{analysis:?}");
    };
    let calls: Vec<_> = calls.into_iter().collect();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].operation.service, "storage");
    assert_eq!(calls[0].operation.operation_id, "create_task_handler");
    assert_eq!(calls[0].method, "POST");
    assert_eq!(calls[0].route, "/documents/create_task");
    assert_eq!(calls[1].operation.operation_id, "get_document_markdown");
    assert_eq!(calls[1].method, "GET");
    assert_eq!(calls[1].route, "/documents/{}/markdown");
    assert_eq!(
        analyzer.sdk_fingerprint(),
        code_mode_assets::JS_TOOLS_FINGERPRINT
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn the_evasion_corpus_is_listed_or_refused() {
    let (_root, analyzer) = analyzer(4).await;
    let calls = |keys: &[&str]| Ok(keys.iter().map(|key| (*key).to_owned()).collect());
    let refused = || Err("cannot_analyze".to_owned());
    let corpus: Vec<(&str, &str, Keys)> = vec![
        (
            "plain",
            "await tools.storage.get_document_markdown({}); return 1",
            calls(&[READ]),
        ),
        (
            "optional",
            "await tools?.storage?.create_task_handler?.({}); return 1",
            calls(&[CREATE]),
        ),
        (
            "bracket",
            r#"await tools["storage"]["delete_document"]({}); return 1"#,
            calls(&[DELETE]),
        ),
        (
            "branch",
            "if (Math.random() > 2) await tools.storage.delete_document({}); return 1",
            calls(&[DELETE]),
        ),
        (
            "in a function",
            "async function f() { return tools.storage.create_task_handler({}) } return await f()",
            calls(&[CREATE]),
        ),
        (
            "in a callback",
            "return await Promise.all([1, 2].map(() => tools.storage.get_document_markdown({})))",
            calls(&[READ]),
        ),
        (
            "spread arguments",
            "await tools.storage.delete_document(...[{}]); return 1",
            calls(&[DELETE]),
        ),
        (
            "async generator",
            "async function* g() { yield await tools.storage.get_document_markdown({}) } for await (const x of g()) {} return 1",
            calls(&[READ]),
        ),
        (
            "a key named tools",
            "const o = { tools: 1 }; return o.tools",
            calls(&[]),
        ),
        (
            "a member named tools",
            "const o = { tools: { a: { b: () => 1 } } }; return o.tools.a.b()",
            calls(&[]),
        ),
        (
            "Function through a constructor",
            "const F = (() => 1).constructor; return F('return tools')()",
            calls(&[]),
        ),
        ("search", "return search('delete')", calls(&[])),
        (
            "require aliased",
            r#"const r = require; const t = r("tools"); await t.storage.delete_document({}); return 1"#,
            refused(),
        ),
        (
            "require.call",
            r#"const t = require.call(null, "tools"); await t.storage.delete_document({})"#,
            refused(),
        ),
        (
            "require.bind",
            r#"const g = require.bind(null, "tools"); await g().storage.delete_document({})"#,
            refused(),
        ),
        (
            "require in an array",
            r#"const t = [require][0]("tools"); await t.storage.delete_document({})"#,
            refused(),
        ),
        (
            "dynamic import",
            r#"const t = await import("tools"); await t.default.storage.delete_document({})"#,
            refused(),
        ),
        (
            "import",
            r#"import t from "tools"; await t.storage.delete_document({})"#,
            refused(),
        ),
        (
            "destructuring",
            "const { storage } = tools; await storage.create_task_handler({})",
            refused(),
        ),
        (
            "an alias",
            "const s = tools.storage; await s.delete_document({})",
            refused(),
        ),
        (
            "a detached function",
            "const f = tools.storage.delete_document; await f({})",
            refused(),
        ),
        (
            "a comma callee",
            "await (0, tools.storage.delete_document)({}); return 1",
            refused(),
        ),
        (
            "a parameter default with a body var",
            "function f(a = tools.storage.delete_document({})) { var tools = 1; return a } return await f()",
            refused(),
        ),
        (
            "a catch parameter",
            "try { throw tools } catch (e) { await e.storage.delete_document({}) }",
            refused(),
        ),
        (
            "a var",
            "var tools = { a: { b: () => 1 } }; return tools.a.b({})",
            refused(),
        ),
        (
            "a parameter",
            "const f = (tools) => tools.a.b({}); return 1",
            refused(),
        ),
        (
            "a function name",
            "const g = function tools() {}; return 1",
            refused(),
        ),
        (
            "a label",
            "tools: for (;;) { break tools }; return 1",
            refused(),
        ),
        ("Object.keys", "return Object.keys(tools)", refused()),
        (
            "tools.search",
            "return await tools.search('delete')",
            refused(),
        ),
        (
            "a .call",
            "await tools.storage.delete_document.call(null, {}); return 1",
            refused(),
        ),
        (
            "an unknown operation",
            "await tools.storage.nope({}); return 1",
            refused(),
        ),
        (
            "three segments",
            "await tools.a.b.c({}); return 1",
            refused(),
        ),
        (
            "one segment",
            "await tools.storage({}); return 1",
            refused(),
        ),
        (
            "a template key",
            "await tools[`storage`].delete_document({}); return 1",
            refused(),
        ),
        (
            "a tagged template",
            "await tools.storage.delete_document`x`; return 1",
            refused(),
        ),
        ("new", "new tools.storage.delete_document({})", refused()),
        ("shorthand", "const o = { tools }; return 1", refused()),
        ("assignment", "tools = 1; return 1", refused()),
        ("typeof", "return typeof tools", refused()),
        (
            "a dotted key",
            r#"await tools["storage.delete_document"]({}); return 1"#,
            refused(),
        ),
    ];
    for (name, source, expected) in corpus {
        let answer = analyzer.may_call(source).await.unwrap();
        assert_eq!(keys(answer), expected, "{name}: {source}");
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn refusals_and_parse_errors_are_located_in_main_js() {
    let (_root, analyzer) = analyzer(1).await;
    let refused = analyzer
        .may_call("const x = 1\nconst r = require\nreturn 1")
        .await
        .unwrap();
    let Analysis::CannotAnalyze(reasons) = refused else {
        panic!("{refused:?}");
    };
    assert_eq!((reasons[0].line, reasons[0].column), (2, 11));

    let broken = analyzer.may_call("return {{").await.unwrap();
    let Analysis::Diagnostics(diagnostics) = broken else {
        panic!("{broken:?}");
    };
    assert_eq!(diagnostics[0].file.as_deref(), Some(PROGRAM));
    assert!(
        diagnostics[0].message.starts_with("main.js:1:"),
        "{}",
        diagnostics[0].message
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn empty_or_oversized_programs_are_refused_unrun() {
    let (root, analyzer) = analyzer(1).await;
    // An entry point that fails: a program that reached it would be Internal.
    std::fs::write(root.path().join("analyze.mjs"), "Deno.exit(3);").unwrap();
    for source in [String::new(), " \n".to_owned(), "x".repeat(64 * 1024 + 1)] {
        assert!(matches!(
            analyzer.may_call(&source).await,
            Err(CheckError::InvalidSource)
        ));
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_waiting_past_the_deadline_for_a_slot_is_busy() {
    let (_root, mut analyzer) = analyzer(1).await;
    analyzer.timeout = Duration::from_millis(200);
    // Every slot is taken until the deadline passes.
    let slots = Arc::clone(&analyzer.slots);
    let _taken = slots.acquire().await.unwrap();
    assert!(matches!(
        analyzer.may_call("return 1").await,
        Err(CheckError::Busy)
    ));
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn an_analysis_that_never_answers_is_stopped_at_the_deadline() {
    let (root, mut analyzer) = analyzer(1).await;
    // An entry point that never finishes stands in for a runaway analysis.
    std::fs::write(root.path().join("analyze.mjs"), "for (;;) {}").unwrap();
    analyzer.timeout = Duration::from_millis(500);
    assert!(matches!(
        analyzer.may_call("return 1").await,
        Err(CheckError::Busy)
    ));
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_failed_process_or_an_unknown_answer_refuses_the_program() {
    let (root, analyzer) = analyzer(1).await;
    for entry in [
        // A nonzero exit, even after printing a good answer.
        r#"console.log('{"status":"ok","operations":[]}'); Deno.exit(3);"#,
        r#"console.log('{"status":"maybe"}');"#,
    ] {
        std::fs::write(root.path().join("analyze.mjs"), entry).unwrap();
        assert!(matches!(
            analyzer.may_call("return 1").await,
            Err(CheckError::Internal)
        ));
    }
}
