use super::*;

mod ocaml;

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

#[test]
fn ocaml_execute_code_extends_the_javascript_tool_without_changing_it() {
    let plain = &toolset().tools["ExecuteCode"];
    let ocaml = &toolset_with_ocaml().tools["ExecuteCode"];
    let plain_schema = serde_json::to_value(&plain.input_schema).unwrap();
    let ocaml_schema = serde_json::to_value(&ocaml.input_schema).unwrap();
    assert!(plain_schema["properties"].get("language").is_none());
    assert!(!plain.description.contains("OCaml"));
    assert!(!plain_schema.to_string().contains("OCaml"));
    // The OCaml tool is the JavaScript one plus a language and the OCaml section.
    assert_eq!(
        ocaml.description,
        format!(
            "{}\n{}",
            plain.description,
            include_str!("session/ocaml.md")
        )
    );
    assert!(ocaml.description.contains("Code_mode.run"));
    let mut properties = ocaml_schema["properties"].as_object().unwrap().clone();
    let language = properties.remove("language").unwrap();
    assert!(language.to_string().contains("javascript"));
    assert!(language.to_string().contains("ocaml"));
    let plain_properties = plain_schema["properties"].as_object().unwrap();
    let names = |object: &serde_json::Map<String, serde_json::Value>| {
        let mut names: Vec<String> = object.keys().cloned().collect();
        names.sort();
        names
    };
    assert_eq!(names(&properties), names(plain_properties));
    assert_eq!(ocaml_schema["required"], plain_schema["required"]);

    let call = serde_json::json!({
        "acting_as": "requester",
        "turn_id": "00000000-0000-0000-0000-000000000001",
        "source": "let () = Code_mode.run (fun _ -> `Null)",
        "language": "ocaml",
    });
    assert!(serde_json::from_value::<ExecuteCode>(call.clone()).is_err());
    let parsed: ExecuteCodeWithOcaml = serde_json::from_value(call).unwrap();
    assert_eq!(parsed.language, OcamlToolLanguage::Ocaml);
    let parsed: ExecuteCodeWithOcaml = serde_json::from_value(serde_json::json!({
        "acting_as": "requester",
        "turn_id": "00000000-0000-0000-0000-000000000001",
        "source": "export async function main() { return {data: 1}; }",
    }))
    .unwrap();
    assert_eq!(parsed.language, OcamlToolLanguage::Javascript);
}

#[test]
fn the_permissions_tool_is_the_ocaml_tool_plus_its_paragraph() {
    let ocaml = &toolset_with_ocaml().tools["ExecuteCode"];
    let gated = &toolset_with_ocaml_permissions().tools["ExecuteCode"];
    assert_eq!(
        gated.description,
        format!(
            "{}\n{}",
            ocaml.description,
            include_str!("session/ocaml_permissions.md")
        )
    );
    assert_eq!(
        serde_json::to_value(&gated.input_schema).unwrap()["properties"],
        serde_json::to_value(&ocaml.input_schema).unwrap()["properties"]
    );
    assert!(!ocaml.description.contains("ShowPermissions"));
}

/// Session code mode that records the language each call asked for.
struct Languages {
    ocaml: bool,
    permissions: bool,
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
    async fn ocaml_enabled(&self, _: &AgentSession) -> bool {
        self.ocaml
    }
    async fn permissions_enabled(&self, _: &AgentSession) -> bool {
        self.permissions
    }
}

#[tokio::test]
async fn sessions_see_and_call_ocaml_only_with_the_rollout() {
    use ai_toolset::ToolSet as _;
    let session = agent_session::testing::test_agent_session(
        agent_session::domain::model::AgentSessionId::new(),
    );
    let call = serde_json::json!({
        "acting_as": "requester",
        "turn_id": "00000000-0000-0000-0000-000000000001",
        "source": "let () = Code_mode.run (fun _ -> `Null)",
        "language": "ocaml",
    });
    for (ocaml, permissions) in [(false, false), (false, true), (true, false), (true, true)] {
        let service = Arc::new(Languages {
            ocaml,
            permissions,
            seen: Default::default(),
        });
        let tools = session_toolset(service.as_ref(), &session).await;
        let schema = serde_json::to_value(&tools.tools["ExecuteCode"].input_schema).unwrap();
        assert_eq!(schema["properties"].get("language").is_some(), ocaml);
        assert_eq!(
            tools.tools["ExecuteCode"]
                .description
                .contains("ShowPermissions"),
            ocaml && permissions
        );
        let result = tools
            .try_tool_call(
                CodeModeToolContext {
                    service: service.clone(),
                    session: session.clone(),
                    cognition: None,
                },
                RequestContext::new(user()),
                "ExecuteCode",
                &call,
            )
            .await;
        if ocaml {
            assert!(result.unwrap().is_ok());
            assert_eq!(*service.seen.lock().unwrap(), [Language::Ocaml]);
        } else {
            // Today's tool has no language: the call is refused unrun.
            assert!(result.is_err());
            assert!(service.seen.lock().unwrap().is_empty());
        }
    }
}

#[tokio::test]
async fn no_session_tool_takes_javascript_tools_programs_yet() {
    use ai_toolset::ToolSet as _;
    let session = agent_session::testing::test_agent_session(
        agent_session::domain::model::AgentSessionId::new(),
    );
    let call = serde_json::json!({
        "acting_as": "requester",
        "turn_id": "00000000-0000-0000-0000-000000000001",
        "source": "return await tools.storage.get_document_markdown({})",
        "language": "js_tools",
    });
    for (ocaml, permissions) in [(false, false), (true, false), (true, true)] {
        let service = Arc::new(Languages {
            ocaml,
            permissions,
            seen: Default::default(),
        });
        let tools = session_toolset(service.as_ref(), &session).await;
        let schema = serde_json::to_value(&tools.tools["ExecuteCode"].input_schema).unwrap();
        assert!(!schema.to_string().contains("js_tools"));
        let result = tools
            .try_tool_call(
                CodeModeToolContext {
                    service: service.clone(),
                    session: session.clone(),
                    cognition: None,
                },
                RequestContext::new(user()),
                "ExecuteCode",
                &call,
            )
            .await;
        assert!(result.is_err());
        assert!(service.seen.lock().unwrap().is_empty());
    }
}
