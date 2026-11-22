use super::*;

mod js_tools;

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
    assert!(
        response
            .sdk_guide
            .unwrap()
            .contains("main({macro}: CodeContext)")
    );
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
fn session_execute_code_assigns_an_id_when_the_agent_omits_one() {
    let schema = serde_json::to_value(&toolset().tools["ExecuteCode"].input_schema).unwrap();
    assert!(schema["properties"].get("execution_id").is_some());
    let required = schema["required"].as_array().unwrap();
    assert!(!required.iter().any(|name| name == "execution_id"));
    let call: ExecuteCode = serde_json::from_value(serde_json::json!({
        "acting_as": "requester",
        "turn_id": "00000000-0000-0000-0000-000000000001",
        "source": "export async function main() { return {data: 1}; }",
    }))
    .unwrap();
    assert!(call.execution_id.is_none());
}

#[test]
fn both_execute_code_descriptions_share_one_runtime_contract() {
    let session = toolset().tools["ExecuteCode"].description.clone();
    let user = user_toolset().tools["ExecuteCode"].description.clone();
    for shared in [
        include_str!("shared/never_guess.md"),
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
fn every_code_tool_forbids_guessing_the_sdk() {
    assert!(
        unseen_execute_code_description().contains(include_str!("shared/never_guess.md").trim())
    );
    let tools = toolset().tools;
    assert!(
        tools["DescribeCodeTools"]
            .description
            .contains("Never guess a method")
    );
    assert!(
        tools["ReadCodeDocs"]
            .description
            .contains("read a result's type before using its fields")
    );
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

/// Session code mode that records the language each call asked for.
struct Languages {
    js_tools: bool,
    seen: std::sync::Mutex<Vec<Language>>,
}

#[async_trait]
impl SessionCodeMode for Languages {
    async fn execute(
        &self,
        _: &AgentSession,
        execution: ExecutionId,
        _: ai_toolset::actor::ToolActor,
        _: macro_uuid::Uuid,
        request: ExecuteRequest,
        _: CancellationToken,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        self.seen.lock().unwrap().push(request.language);
        Ok(ExecutionReceipt {
            execution_id: execution,
            status: crate::domain::ExecutionStatus::Succeeded,
            activity: Vec::new(),
            result: None,
            error: None,
            model_media: Vec::new(),
            permission: None,
        })
    }
    async fn read(
        &self,
        _: &entity_access::domain::models::EntityAccessReceipt<
            entity_access::domain::models::ViewAccessLevel,
        >,
        _: ExecutionId,
    ) -> Result<crate::domain::ExecutionRecord, CodeModeError> {
        Err(CodeModeError::NotFound)
    }
}

#[async_trait]
impl crate::domain::CodeModeKinds for Languages {
    async fn code_mode_kind(
        &self,
        _: agent_session::domain::model::AgentSessionId,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> crate::domain::CodeModeKind {
        if self.js_tools {
            crate::domain::CodeModeKind::Dialect
        } else {
            crate::domain::CodeModeKind::TypeScript
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
    // The guide topics, the compose-routines skill and the SDK's own entity
    // guides, as models read them.
    let guides: Vec<String> = [
        include_str!("../../../SKILL.md").to_owned(),
        include_str!("guides/ai.md").to_owned(),
        include_str!("guides/templates.md").to_owned(),
        system_skills::compose_routines::CODE.to_string(),
    ]
    .into_iter()
    .chain(
        crate::domain::sdk_documentation()
            .iter()
            .filter_map(|entity| entity.guide.clone()),
    )
    .collect();
    let mut examples = 0;
    for guide in &guides {
        // A whole program in any other fence would go unchecked.
        for fence in ["```js\n", "```javascript\n", "```ts\n"] {
            for block in guide.split(fence).skip(1) {
                let source = block.split("```").next().unwrap();
                assert!(
                    !source.contains("export async function main({macro")
                        && !source.contains("export async function main({ macro"),
                    "a program fenced {fence:?} isn't checked:\n{source}"
                );
            }
        }
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
                        language: Language::Javascript,
                        module: None,
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
    assert_eq!(examples, 9);
    service.shutdown().await;
}

/// What a TypeScript turn sees of its code-mode tools, the prompt's
/// code-mode sections and the discovery guides: today's, byte for byte.
/// `UPDATE_TOOLSET_SNAPSHOT=1` rewrites it; a change to it must be one meant
/// for sessions without agent permissions.
#[tokio::test]
async fn sessions_without_javascript_tools_see_todays_tools() {
    // Each distinct set of tools once, and which one each kind sees.
    let mut toolsets: Vec<serde_json::Value> = Vec::new();
    let mut sessions = serde_json::Map::new();
    for kind in [CodeModeKind::TypeScript] {
        let tools: serde_json::Map<_, _> = session_toolset(kind)
            .tools
            .iter()
            .map(|(name, tool)| {
                (
                    name.clone(),
                    serde_json::json!({
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    }),
                )
            })
            .collect();
        let tools = serde_json::Value::from(tools);
        let index = match toolsets.iter().position(|seen| *seen == tools) {
            Some(index) => index,
            None => {
                toolsets.push(tools);
                toolsets.len() - 1
            }
        };
        sessions.insert(
            serde_json::to_value(kind)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned(),
            index.into(),
        );
    }
    // The code-mode texts a TypeScript session reads beside the tools: the
    // prompt's code-mode sections and the discovery tools' hand-written
    // guides. (The search topic is the SDK's generated guidance.)
    let describe = DescribeCodeTools {
        task: None,
        names: Vec::new(),
        topics: vec![
            CodeGuideTopic::Ai,
            CodeGuideTopic::Templates,
            CodeGuideTopic::Examples,
        ],
    }
    .describe(CodeHost::Session, &user(), None, &CancellationToken::new())
    .await
    .unwrap();
    let texts = serde_json::json!({
        "prompt": [
            prompt::code_mode::PROMPT.to_string(),
            prompt::user_tools::CODE_MODE_SESSION_PROMPT.to_string(),
        ],
        "describe_code_tools": {
            "sdk_guide": describe.sdk_guide,
            "instructions": describe.instructions,
            "guides": describe.guides,
        },
    });
    let snapshot =
        serde_json::json!({ "sessions": sessions, "toolsets": toolsets, "texts": texts });
    let actual = serde_json::to_string_pretty(&snapshot).unwrap() + "\n";
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/inbound/toolset/test/without_js_tools.json"
    );
    if std::env::var_os("UPDATE_TOOLSET_SNAPSHOT").is_some() {
        std::fs::write(path, &actual).unwrap();
    }
    assert!(
        actual == include_str!("test/without_js_tools.json"),
        "session code-mode tools changed for sessions without JavaScript tools programs; \
         rerun with UPDATE_TOOLSET_SNAPSHOT=1 only if that is meant"
    );
}

/// A dialect turn's ExecuteCode: `source` is always the dialect, `module`
/// is optional TypeScript, and there is no `language` to choose with.
#[test]
fn the_dialect_execute_code_has_source_and_module_and_no_language() {
    let plain = &toolset().tools["ExecuteCode"];
    let dialect = &toolset_with_js_tools().tools["ExecuteCode"];
    assert!(
        dialect
            .description
            .starts_with(include_str!("session/js_tools.md"))
    );
    assert!(
        dialect
            .description
            .contains(include_str!("session/js_tools_permissions.md").trim_end())
    );
    let plain_schema = serde_json::to_value(&plain.input_schema).unwrap();
    let schema = serde_json::to_value(&dialect.input_schema).unwrap();
    let names = |schema: &serde_json::Value| {
        let mut names: Vec<String> = schema["properties"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        names.sort();
        names
    };
    let mut expected = names(&plain_schema);
    expected.push("module".into());
    expected.sort();
    assert_eq!(names(&schema), expected);
    assert!(schema["properties"].get("language").is_none());
    assert_eq!(schema["required"], plain_schema["required"]);

    let parse = |extra: serde_json::Value| {
        let mut call = serde_json::json!({
            "acting_as": "requester",
            "turn_id": "00000000-0000-0000-0000-000000000001",
            "source": "return 1",
        });
        for (key, value) in extra.as_object().unwrap() {
            call[key] = value.clone();
        }
        serde_json::from_value::<ExecuteCodeWithJsTools>(call)
    };
    assert_eq!(parse(serde_json::json!({})).unwrap().module, None);
    assert_eq!(
        parse(serde_json::json!({"module": "export const x = 1;"}))
            .unwrap()
            .module
            .as_deref(),
        Some("export const x = 1;")
    );
    // Nothing chooses a language: the program is always the dialect.
    assert!(parse(serde_json::json!({"language": "javascript"})).is_err());
    assert!(parse(serde_json::json!({"language": "js_tools"})).is_err());
}

/// Each kind's ExecuteCode teaches only its own code: the dialect's never
/// a TypeScript SDK call, today's never a dialect operation call.
#[test]
fn each_kinds_execute_code_teaches_only_its_own_code() {
    let dialect = &toolset_with_js_tools().tools["ExecuteCode"];
    let dialect_text = format!(
        "{}{}",
        dialect.description,
        serde_json::to_string(&dialect.input_schema).unwrap()
    );
    for marker in [
        "macro.",
        "@macro-inc/sdk",
        "export async function main",
        "CodeContext",
        "execution.views",
        "execution.reviews",
    ] {
        assert!(
            !dialect_text.contains(marker),
            "the dialect teaches {marker}"
        );
    }
    assert!(dialect_text.contains("tools.<service>.<operation>"));
    let typescript = &toolset().tools["ExecuteCode"];
    let typescript_text = format!(
        "{}{}",
        typescript.description,
        serde_json::to_string(&typescript.input_schema).unwrap()
    );
    for marker in [
        "tools.<service>",
        "tools.storage",
        "tools.agent_harness",
        "get(\"",
        "call(\"",
    ] {
        assert!(
            !typescript_text.contains(marker),
            "TypeScript teaches {marker}"
        );
    }
}

/// The JS tools texts name real catalog operations.
#[test]
fn the_js_tools_texts_call_catalog_operations() {
    let catalog: serde_json::Value =
        serde_json::from_str(code_mode_assets::JS_TOOLS_CATALOG).unwrap();
    let paths: Vec<String> = catalog["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| {
            tool["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|segment| segment.as_str().unwrap())
                .collect::<Vec<_>>()
                .join(".")
        })
        .collect();
    let texts = toolset_with_js_tools().tools["ExecuteCode"]
        .description
        .clone();
    for path in [
        "storage.create_task_handler",
        "storage.get_document_markdown",
        "agent_harness.get_agent_session",
        "agent_harness.get_agent_tool_permissions",
        "agent_harness.tighten_agent_tool_permissions",
        "agent_harness.list_agent_session_updates",
    ] {
        assert!(paths.contains(&path.to_owned()), "{path}");
        assert!(texts.contains(&format!("tools.{path}")), "{path}");
    }
}

/// JavaScript tools programs are offered and run only with their rollout.
#[tokio::test]
async fn sessions_see_and_call_js_tools_only_with_the_rollout() {
    use ai_toolset::ToolSet as _;
    let session = agent_session::testing::test_agent_session(
        agent_session::domain::model::AgentSessionId::new(),
    );
    let call = serde_json::json!({
        "acting_as": "requester",
        "turn_id": "00000000-0000-0000-0000-000000000001",
        "source": "return await tools.storage.get_document_markdown({path: {document_id: \"d\"}})",
        "module": "export const x = 1;",
    });
    for js_tools in [false, true] {
        let service = Arc::new(Languages {
            js_tools,
            seen: Default::default(),
        });
        let kind = if js_tools {
            CodeModeKind::Dialect
        } else {
            CodeModeKind::TypeScript
        };
        let tools = session_toolset(kind);
        let tool = &tools.tools["ExecuteCode"];
        let schema = serde_json::to_value(&tool.input_schema).unwrap();
        assert_eq!(schema["properties"].get("module").is_some(), js_tools);
        assert_eq!(
            tool.description.contains("tools.<service>.<operation>"),
            js_tools
        );
        assert_eq!(tool.description.contains("ShowPermissions"), js_tools);
        let context = || CodeModeToolContext {
            service: service.clone(),
            session: session.clone(),
            cognition: None,
            kind,
        };
        let result = tools
            .try_tool_call(context(), RequestContext::new(user()), "ExecuteCode", &call)
            .await;
        if js_tools {
            assert!(result.unwrap().is_ok());
            assert_eq!(*service.seen.lock().unwrap(), [Language::JsTools]);
        } else {
            // TypeScript's tool takes no module: refused unrun.
            assert!(result.is_err());
            assert!(service.seen.lock().unwrap().is_empty());
        }
    }
}
