use super::*;
use crate::domain::CodeModeKind;
use crate::inbound::toolset::{CodeGuideTopic, session_toolset, toolset};
use ai_toolset::AsyncToolCollection;

/// Where `text` calls the TypeScript SDK: `macro.<name>` (not the macro.com
/// domain), the `execution` handle, a `main` module or the SDK package.
fn typescript_calls(text: &str) -> Vec<&str> {
    let mut found: Vec<&str> = text
        .match_indices("macro.")
        .filter(|(index, _)| {
            let rest = &text[index + "macro.".len()..];
            rest.starts_with(|c: char| c.is_ascii_lowercase()) && !rest.starts_with("com")
        })
        .map(|(index, _)| &text[index..(index + 30).min(text.len())])
        .collect();
    for marker in [
        "execution.views",
        "execution.reviews",
        "export async function main",
        "@macro-inc/sdk",
        "webUrl()",
        "EmailDraft.",
        "EmailMessage.",
        "canvas.render",
        "toMarkdown()",
        "CodeContext",
        "for await",
        "SDK document-write",
    ] {
        if text.contains(marker) {
            found.push(marker);
        }
    }
    found
}

/// Every dialect operation `text` calls, `tools.<service>.<operation>`.
fn dialect_calls(text: &str) -> Vec<String> {
    text.match_indices("tools.")
        .filter(|(index, _)| {
            let before = text[..*index].chars().next_back();
            let after = text[index + "tools.".len()..].chars().next();
            !before.is_some_and(|c| c.is_ascii_alphanumeric())
                && after.is_some_and(|c| c.is_ascii_lowercase())
        })
        .map(|(index, _)| {
            text[index + "tools.".len()..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '.')
                .collect::<String>()
                .trim_end_matches('.')
                .to_owned()
        })
        .collect()
}

/// The discovery tools' descriptions and input schemas, as a model reads
/// them. (`ExecuteCode`'s texts belong to its own tests.)
fn tool_texts(tools: &AsyncToolCollection<CodeModeToolContext>) -> String {
    ["DescribeCodeTools", "ReadCodeDocs"]
        .iter()
        .map(|name| &tools.tools[*name])
        .map(|tool| {
            format!(
                "{}\n{}\n",
                tool.description,
                serde_json::to_string(&tool.input_schema).unwrap()
            )
        })
        .collect()
}

/// Every agent-facing text of the dialect this crate and the prompt own.
fn dialect_texts() -> String {
    let mut texts = format!(
        "{}{OVERVIEW}{DISCOVERY}{}{}",
        tool_texts(&session_toolset(CodeModeKind::Dialect)),
        prompt::dialect::session_tool_use_prompt(),
        prompt::dialect::agent_session_prompt(),
    );
    for guide in DialectGuide::ALL {
        texts.push_str(guide.markdown());
    }
    texts
}

#[test]
fn each_kind_teaches_only_its_own_code() {
    let dialect = dialect_texts();
    assert_eq!(typescript_calls(&dialect), Vec::<&str>::new());
    assert!(dialect.contains("tools.<service>.<operation>"));

    // Today's texts: the discovery tools, their session guides and topics,
    // and the prompt's code-mode sections. (The ExecuteCode description and
    // the SDK's own generated documentation are pinned elsewhere.)
    let mut typescript = format!(
        "{}{}{}{}{}{}",
        tool_texts(&session_toolset(CodeModeKind::TypeScript)),
        include_str!("../session/overview.md"),
        include_str!("../shared/entities.md"),
        include_str!("../session/discovery.md"),
        prompt::code_mode::PROMPT,
        prompt::CODE_MODE_SESSION_TOOL_USE_PROMPT,
    );
    for topic in [
        CodeGuideTopic::Search,
        CodeGuideTopic::Ai,
        CodeGuideTopic::Templates,
        CodeGuideTopic::Examples,
    ] {
        typescript.push_str(topic.markdown());
    }
    assert_eq!(dialect_calls(&typescript), Vec::<String>::new());
    assert!(!typescript_calls(&typescript).is_empty());
}

/// The dialect texts call only operations the catalog has, so a program
/// written from them can run.
#[test]
fn dialect_texts_call_catalog_operations() {
    let catalog: serde_json::Value =
        serde_json::from_str(code_mode_assets::JS_TOOLS_CATALOG).unwrap();
    let paths: Vec<String> = catalog["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| {
            let path = tool["path"].as_array().unwrap();
            format!(
                "{}.{}",
                path[0].as_str().unwrap(),
                path[1].as_str().unwrap()
            )
        })
        .collect();
    let calls = dialect_calls(&dialect_texts());
    assert!(calls.contains(&"agent_harness.create_session_review".to_owned()));
    for call in calls {
        // `tools.storage["create_task_handler"]` names its operation in
        // brackets, and `tools.<service>.<operation>` is the pattern.
        if !call.contains('.') {
            continue;
        }
        assert!(paths.contains(&call), "{call} is not in the catalog");
    }
}

/// A TypeScript session's discovery tools are today's, byte for byte.
#[test]
fn the_typescript_discovery_tools_are_todays() {
    let today = toolset();
    let typescript = session_toolset(CodeModeKind::TypeScript);
    for name in ["DescribeCodeTools", "ReadCodeDocs"] {
        assert_eq!(
            typescript.tools[name].description,
            today.tools[name].description
        );
        assert_eq!(
            serde_json::to_value(&typescript.tools[name].input_schema).unwrap(),
            serde_json::to_value(&today.tools[name].input_schema).unwrap()
        );
    }
    let dialect = session_toolset(CodeModeKind::Dialect);
    assert_eq!(
        dialect.tools.keys().collect::<Vec<_>>(),
        typescript.tools.keys().collect::<Vec<_>>()
    );
}

#[test]
fn dialect_discovery_serves_the_overview_and_named_guides() {
    let overview = DescribeDialect { guides: Vec::new() }.describe().unwrap();
    assert_eq!(overview.overview, OVERVIEW);
    assert_eq!(overview.instructions, DISCOVERY);
    assert!(overview.guides.is_empty());

    let described = DescribeDialect {
        guides: vec![DialectGuide::Module, DialectGuide::Permissions],
    }
    .describe()
    .unwrap();
    let guides: Vec<_> = described.guides.iter().map(|page| page.guide).collect();
    assert_eq!(guides, [DialectGuide::Module, DialectGuide::Permissions]);
    assert!(
        described.guides[0]
            .markdown
            .contains("await call(\"name\", ...args)")
    );
    assert!(described.guides[1].markdown.contains("Never: nothing runs"));

    let read = ReadDialectDocs {
        guides: vec![DialectGuide::Results],
    }
    .read()
    .unwrap();
    assert_eq!(read.guides[0].markdown, DialectGuide::Results.markdown());
    assert!(ReadDialectDocs { guides: Vec::new() }.read().is_err());
    assert!(
        DescribeDialect {
            guides: vec![DialectGuide::Program; 7]
        }
        .describe()
        .is_err()
    );
}

/// Every example program in the dialect guides is one the analyzer admits,
/// naming the operations it calls, as a run would check it.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn every_dialect_example_is_analyzed() {
    use code_execution::domain::{Analysis, ProgramAnalyzer};

    let root = tempfile::tempdir().unwrap();
    let binary = tokio::process::Command::new("which")
        .arg("deno")
        .output()
        .await
        .unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let analyzer = code_execution::outbound::deno::analyze::JsToolsAnalyzer::new(
        String::from_utf8(binary.stdout).unwrap().trim().into(),
        root.path().to_owned(),
        2,
        64 * 1024,
    )
    .await
    .unwrap();
    let mut examples = 0;
    for guide in DialectGuide::ALL {
        for block in guide.markdown().split("```js\n").skip(1) {
            let source = block.split("```").next().unwrap();
            let analysis = analyzer.may_call(source).await.unwrap();
            let Analysis::Calls(calls) = analysis else {
                panic!("{guide:?}: {analysis:?}\n{source}");
            };
            assert_eq!(
                calls.len(),
                dialect_calls(source).len(),
                "{guide:?}: {source}"
            );
            examples += 1;
        }
    }
    assert!(examples >= 5);
}
