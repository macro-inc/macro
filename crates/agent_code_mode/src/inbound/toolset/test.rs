use super::*;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|fixture@example.com").unwrap()
}

async fn describe(
    tool: DescribeCodeTools,
    host: CodeHost,
) -> Result<CodeToolsDescription, CodeModeError> {
    tool.describe(host, &user(), None, &CancellationToken::new())
        .await
}

#[tokio::test]
async fn entity_catalog_is_compact_and_named_entities_list_their_symbols() {
    let catalog = describe(
        DescribeCodeTools {
            task: None,
            names: vec![],
            topics: vec![],
        },
        CodeHost::Session,
    )
    .await
    .unwrap();
    assert!(catalog.tools.len() > 15);
    assert!(catalog.tools.iter().all(|doc| doc.index.is_none()));
    let docs = describe(
        DescribeCodeTools {
            task: None,
            names: vec!["documents".into(), "email".into()],
            topics: vec![],
        },
        CodeHost::Session,
    )
    .await
    .unwrap();
    let documents = docs.tools[0].index.as_deref().unwrap();
    assert!(
        documents
            .contains("`DocumentNamespace.search`: search(query, opts?): AsyncGenerator<Document>")
    );
    assert!(
        docs.tools[1]
            .index
            .as_deref()
            .unwrap()
            .contains("(`macro.email`)")
    );
    assert!(
        docs.tools
            .iter()
            .all(|doc| doc.index.as_ref().unwrap().len() < 16 * 1024)
    );
    assert!(
        describe(
            DescribeCodeTools {
                task: None,
                names: vec!["NameSearch".into()],
                topics: vec![]
            },
            CodeHost::Session
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn guide_only_discovery_omits_catalog_and_limits_are_enforced() {
    let response = describe(
        DescribeCodeTools {
            task: None,
            names: vec![],
            topics: vec![CodeGuideTopic::Examples],
        },
        CodeHost::Session,
    )
    .await
    .unwrap();
    assert!(response.tools.is_empty());
    assert_eq!(
        response.guides[0].markdown,
        include_str!("../../../SKILL.md")
    );
    assert!(
        describe(
            DescribeCodeTools {
                task: None,
                names: vec!["documents".into(); 6],
                topics: vec![]
            },
            CodeHost::Session
        )
        .await
        .is_err()
    );
    assert!(
        describe(
            DescribeCodeTools {
                task: None,
                names: vec![],
                topics: vec![CodeGuideTopic::Search; 5]
            },
            CodeHost::Session
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn task_without_jev_reports_status_and_keeps_the_catalog() {
    let response = describe(
        DescribeCodeTools {
            task: Some("summarize my recent documents".into()),
            names: vec![],
            topics: vec![],
        },
        CodeHost::User,
    )
    .await
    .unwrap();
    let task = response.task_documentation.unwrap();
    assert_eq!(task.status, crate::domain::SelectionStatus::Unconfigured);
    assert!(task.entities.is_empty());
    assert!(response.tools.len() > 15);
    assert!(response.sdk_guide.unwrap().contains("main({macro})"));
}

#[tokio::test]
async fn user_host_rejects_session_only_guides() {
    for topic in [CodeGuideTopic::Templates, CodeGuideTopic::Examples] {
        assert!(
            describe(
                DescribeCodeTools {
                    task: None,
                    names: vec![],
                    topics: vec![topic],
                },
                CodeHost::User,
            )
            .await
            .is_err()
        );
    }
    assert!(
        describe(
            DescribeCodeTools {
                task: None,
                names: vec![],
                topics: vec![CodeGuideTopic::Search, CodeGuideTopic::Ai],
            },
            CodeHost::User,
        )
        .await
        .is_ok()
    );
}

#[test]
fn user_toolset_exposes_execute_and_discovery_without_session_fields() {
    let tools = user_toolset();
    let mut names: Vec<_> = tools.tools.keys().map(String::as_str).collect();
    names.sort();
    assert_eq!(names, ["DescribeCodeTools", "ExecuteCode", "ReadCodeDocs"]);
    let schema = serde_json::to_value(&tools.tools["ExecuteCode"].input_schema).unwrap();
    assert!(schema["properties"].get("execution_id").is_none());
    assert!(schema["properties"].get("source").is_some());
}

#[test]
fn both_execute_code_descriptions_share_one_runtime_contract() {
    let session = toolset().tools["ExecuteCode"].description.clone();
    let user = user_toolset().tools["ExecuteCode"].description.clone();
    for shared in [
        include_str!("shared/program.md"),
        include_str!("shared/runtime.md"),
    ] {
        assert!(session.contains(shared.trim()));
        assert!(user.contains(shared.trim()));
    }
    assert!(session.contains("execution.reviews.create"));
    assert!(!user.contains("execution.reviews.create"));
    assert!(user.contains("DescribeCodeTools with task"));
}

#[test]
fn symbols_from_an_index_read_as_their_own_references() {
    let read = ReadCodeDocs {
        symbols: vec![
            "TaskNamespace.create".into(),
            "Task".into(),
            "TaskNamespace.missing".into(),
        ],
    }
    .read()
    .unwrap();
    let references: Vec<_> = read
        .references
        .iter()
        .map(|reference| reference.symbol.as_str())
        .collect();
    assert_eq!(references, ["TaskNamespace.create", "Task"]);
    // A method's reference carries its option fields, linked by symbol.
    assert!(read.references[0].reference.contains("`opts.name`"));
    assert!(read.references[0].reference.contains("`Task`"));
    assert!(!read.references[0].reference.contains(".md"));
    assert_eq!(read.unknown, ["TaskNamespace.missing"]);
    assert!(
        ReadCodeDocs { symbols: vec![] }.read().is_err()
            && ReadCodeDocs {
                symbols: vec!["Task".into(); 11]
            }
            .read()
            .is_err()
    );
}

/// Answers every run with what it would have run, so a check is all that
/// stands between an example and success.
struct Accepts;

#[async_trait::async_trait]
impl code_execution::domain::CodeRunner for Accepts {
    async fn run(
        &self,
        _job: code_execution::domain::ExecutionJob,
        _events: &mut code_execution::domain::EventSink,
        _cancellation: CancellationToken,
    ) -> code_execution::domain::Outcome {
        code_execution::domain::Outcome::Succeeded {
            value: serde_json::Value::Null,
        }
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn every_documented_example_type_checks() {
    use code_execution::domain::{
        EventKind, ExecuteRequest, ExecutionService, Limits, Outcome, RunEnvironment,
    };

    let root = tempfile::tempdir().unwrap();
    let binary = tokio::process::Command::new("which")
        .arg("deno")
        .output()
        .await
        .unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let checker = code_execution::outbound::deno::check::DenoChecker::new(
        String::from_utf8(binary.stdout).unwrap().trim().into(),
        root.path().to_owned(),
        2,
        8,
        64 * 1024,
    )
    .await
    .unwrap();
    let service = ExecutionService::new(
        std::sync::Arc::new(Accepts),
        std::sync::Arc::new(checker),
        Limits::default(),
    )
    .unwrap();
    // The guide topics and the SDK's own entity guides, as models read them.
    let guides = [
        include_str!("../../../SKILL.md"),
        include_str!("guides/ai.md"),
        include_str!("guides/templates.md"),
    ]
    .into_iter()
    .chain(
        crate::domain::sdk_documentation()
            .iter()
            .filter_map(|entity| entity.guide.as_deref()),
    );
    let mut examples = 0;
    for guide in guides {
        for block in guide.split("```typescript\n").skip(1) {
            let source = block.split("```").next().unwrap();
            if !source.contains("export async function main") {
                continue;
            }
            examples += 1;
            let mut handle = service
                .execute(
                    ExecuteRequest {
                        source: source.into(),
                        timeout_ms: 30_000,
                    },
                    // Examples may use the session and the execution.
                    RunEnvironment {
                        session_id: Some(uuid::Uuid::now_v7()),
                        execution_id: Some(uuid::Uuid::now_v7()),
                        ..RunEnvironment::default()
                    },
                )
                .unwrap();
            let outcome = loop {
                match handle.events.recv().await.unwrap().kind {
                    EventKind::Finished { outcome } => break outcome,
                    _ => continue,
                }
            };
            assert!(
                matches!(outcome, Outcome::Succeeded { .. }),
                "{source}\n{outcome:?}"
            );
        }
    }
    assert_eq!(examples, 7);
    service.shutdown().await;
}
