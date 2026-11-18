//! Source composer goldens are compared as exact output bytes or exact success/failure.
use macro_document_composers::*;
use macro_document_model::{DocumentContext, NodeClock, NodeHost, NodeRandom};
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn typed_server_composers_match_all_source_goldens() -> macro_document_model::Result<()> {
    let context = DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    };
    let mut failures = Vec::new();
    let mut native_inputs = Vec::new();
    let mut native_outputs = Vec::new();
    for line in include_str!("corpus/composers.jsonl").lines() {
        let row: Value = serde_json::from_str(line)?;
        let input = &row["input"];
        let actual = (|| -> macro_document_model::Result<String> {
            match row["route"].as_str().expect("route") {
                "endpoint-announcement" => {
                    Ok(wire::handle_agent_announcement(input, &context)?.markdown)
                }
                "agent-context" => {
                    wire::compose_agent_context(&wire::agent_context_from_json(input)?, &context)
                }
                "chat" => {
                    compose_agent_chat_reply(&serde_json::from_value(input.clone())?, &context)
                }
                "announcement" => compose_agent_session_announcement(
                    &serde_json::from_value(input.clone())?,
                    &context,
                ),
                "connection" => compose_agent_connection_prompt(
                    &serde_json::from_value(input.clone())?,
                    &context,
                ),
                "image" => compose_image_markdown(&wire::image_from_json(input)?, &context),
                _ => panic!("unknown route"),
            }
        })();
        if row["route"] == "agent-context"
            && let Ok(native) = serde_json::from_value::<AgentContextPrompt>(input.clone())
        {
            native_inputs.push(serde_json::to_value(&native)?);
            native_outputs.push(compose_agent_context_prompt(&native, &context)?);
        }
        let observed = actual
            .as_ref()
            .map_or_else(|_| json!({"throws":true}), |value| json!({"value":value}));
        if observed != row["expected"] {
            failures.push(json!({"name":row["name"],"input":input,"actual":observed,"error":actual.err().map(|e|e.to_string()),"expected":row["expected"]}));
        }
    }
    assert!(native_inputs.len() >= 50, "native typed context coverage");
    use std::io::Write;
    let native_input_bytes = serde_json::to_vec(&native_inputs)?;
    let mut source = std::process::Command::new("bun")
        .args([
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../packages/lexical-conformance/corpus/macro-composers.ts"
            ),
            "--native",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("source native oracle");
    source
        .stdin
        .take()
        .expect("oracle stdin")
        .write_all(&native_input_bytes)
        .expect("native inputs");
    let source = source.wait_with_output().expect("native oracle completion");
    assert!(
        source.status.success(),
        "{}",
        String::from_utf8_lossy(&source.stderr)
    );
    assert_eq!(
        native_outputs,
        serde_json::from_slice::<Vec<String>>(&source.stdout)?,
        "native domain serialization must match actual source"
    );
    std::fs::create_dir_all("target").expect("artifact directory");
    std::fs::write(
        "target/composer-mismatches.json",
        serde_json::to_vec_pretty(&failures)?,
    )
    .expect("mismatch report");
    assert!(
        failures.is_empty(),
        "{} composer mismatches: {}",
        failures.len(),
        serde_json::to_string(&failures.iter().take(3).collect::<Vec<_>>())?
    );
    Ok(())
}
