//! The literal text of an agent prompt's reproducible parts, rendered by the
//! code of the checkout it is built in.
//!
//! `agent-session-view --reconstruct` copies this file to
//! `crates/ai_tools/examples/` of a checkout at the commit that served a
//! session and runs it there, so every string comes from that commit's own
//! code; nothing here re-implements it. The leading newlines the harness puts
//! before the identity and integrations sections are the only glue copied,
//! and every part is checked against the span's byte count and hash.
//!
//! stdin, JSON:
//!   {"docs": [{"entities": ["channels", ...], "guidance": "Inline" | "Selected"}],
//!    "identities": [{"name": "...", "handle": "..."}],
//!    "integrations": [["GitHub", ...]]}
//! stdout, JSON:
//!   {"docs": [text], "preamble": text, "macro_prompt": text,
//!    "routed_macro_prompt": text, "identities": [text], "integrations": [text | null]}

use std::sync::Arc;

use agent_code_mode::domain::{Guidance, select_documentation};
use async_trait::async_trait;
use cognition::domain::{
    Cognition, DecisionRequest, DecisionResponse, GenerateObjectRequest, GenerateObjectResponse,
    RoutingRequest,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

/// Answers the documentation selection as the span recorded it: yes to the
/// selected entities, in their recorded order, and no to every other.
struct Recorded(Vec<String>);

#[async_trait]
impl Cognition for Recorded {
    async fn generate_object(
        &self,
        _: &MacroUserIdStr<'static>,
        _: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        Err(rootcause::report!(
            "documentation selection does not generate"
        ))
    }

    async fn decide(
        &self,
        _: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        // Each question reads "Would the SDK entity <name> help with this
        // request? …". Scores fall with the recorded rank, so the selection
        // sorts the entities back into it.
        let probabilities = request
            .questions
            .iter()
            .map(|(key, question)| {
                let name = question.split_whitespace().nth(4).unwrap_or_default();
                let score = match self.0.iter().position(|selected| selected == name) {
                    Some(rank) => 0.99 - rank as f32 * 0.01,
                    None => 0.0,
                };
                (key.clone(), score)
            })
            .collect();
        Ok(DecisionResponse { probabilities })
    }
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

async fn documentation(request: &Value, user: &MacroUserIdStr<'static>) -> String {
    let guidance = match request["guidance"].as_str() {
        Some("Selected") => Guidance::Selected,
        _ => Guidance::Inline,
    };
    let cognition: Arc<dyn Cognition> = Arc::new(Recorded(strings(&request["entities"])));
    select_documentation(
        user,
        RoutingRequest {
            latest: "",
            previous: None,
        },
        Some(&cognition),
        guidance,
        &CancellationToken::new(),
    )
    .await
}

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("a JSON request on stdin");
    let user = MacroUserIdStr::parse_from_str("macro|reconstruct@example.com").expect("a user id");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    let mut docs = Vec::new();
    for request in input["docs"].as_array().into_iter().flatten() {
        docs.push(runtime.block_on(documentation(request, &user)));
    }

    let tools = ai_tools::tools_for_agent_code_mode();
    let identities: Vec<String> = input["identities"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|identity| {
            let name = identity["name"].as_str().unwrap_or_default();
            let handle = identity["handle"].as_str().unwrap_or_default();
            format!("\n{}", prompt::agent_identity::render(name, handle))
        })
        .collect();
    let integrations: Vec<Option<String>> = input["integrations"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|names| {
            prompt::connected_toolsets::render(&strings(names))
                .map(|section| format!("\n\n{section}"))
        })
        .collect();

    let output = json!({
        "docs": docs,
        "preamble": prompt::agent_session::PROMPT.to_string(),
        "macro_prompt": tools.prompt.to_string(),
        "routed_macro_prompt": tools.routed_prompt.to_string(),
        "identities": identities,
        "integrations": integrations,
    });
    println!("{output}");
}
