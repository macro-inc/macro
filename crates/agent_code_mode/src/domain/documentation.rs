//! Bounded SDK documentation selection through the shared cognition service.
use cognition::domain::{Cognition, DecisionRequest};
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod eval;

/// One SDK entity, generated from the real SDK by TypeDoc.
#[derive(Clone, Deserialize, Serialize, JsonSchema)]
pub struct SdkDocumentation {
    /// SDK namespace.
    pub name: String,
    /// When to use the entity: its `@routing` sentence, "Use when …; not …".
    pub description: String,
    /// How this area of Macro works: the entity's `@agent` guidance, when it
    /// has some; omitted in a compact catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guide: Option<String>,
    /// Every class, method and type the entity declares, one line each and
    /// named by the symbol `ReadCodeDocs` reads; omitted in a compact catalog.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
}

/// Where a turn's area guidance lives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Guidance {
    /// Every area's guidance is in the prompt already ([`inline_guides`]), so
    /// selected entities bring only their index.
    Inline,
    /// Selected entities bring their guidance with their index.
    Selected,
}

/// The SDK reference as generated: an index per entity, and each symbol's own
/// reference by name (`Task`, `Task.update`, `storage.Message`).
#[derive(Deserialize)]
struct Generated {
    entities: Vec<SdkDocumentation>,
    symbols: HashMap<String, String>,
}

static GENERATED: LazyLock<Generated> = LazyLock::new(|| {
    serde_json::from_str(code_mode_assets::DOCUMENTATION)
        .expect("generated SDK documentation is valid")
});

/// Every SDK entity with its index, supplied at build time.
pub fn sdk_documentation() -> &'static [SdkDocumentation] {
    &GENERATED.entities
}

/// The reference for one symbol an entity index or another reference names.
pub fn symbol_reference(symbol: &str) -> Option<&'static str> {
    GENERATED.symbols.get(symbol).map(String::as_str)
}

/// One entity's `@agent` guidance, for hosts that carry a single area whole.
pub fn entity_guide(name: &str) -> Option<&'static str> {
    sdk_documentation()
        .iter()
        .find(|doc| doc.name == name)
        .and_then(|doc| doc.guide.as_deref())
}

/// The entity whose guidance is searching across the workspace.
const SEARCH_ENTITY: &str = "search";

/// How to search across the workspace in code: the `search` entity's guidance,
/// also the `search` guide topic.
pub fn search_guide() -> &'static str {
    entity_guide(SEARCH_ENTITY).unwrap_or_default()
}

/// The areas MCP clients write into and must know the rules of before the
/// first call: database tables, CRM pipelines and document content.
const MCP_GUIDES: [&str; 3] = ["databases", "crm", "documents"];

/// The guidance external MCP clients get in the server instructions.
pub fn mcp_guides() -> &'static str {
    static MCP: LazyLock<String> = LazyLock::new(|| {
        MCP_GUIDES
            .iter()
            .filter_map(|name| {
                entity_guide(name).map(|guide| format!("\n# Macro {name}\n{guide}\n"))
            })
            .collect()
    });
    &MCP
}

/// Which prompt carries the area guidance inline.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuideHost {
    /// A code-mode agent session: every area.
    Code,
    /// A host whose tools run directly: the areas whose guidance does not
    /// depend on calling the SDK.
    Direct,
}

/// Entities whose guidance is about calling the SDK, which direct-tool hosts
/// cannot do; those hosts keep their own tool guidance for them.
const SDK_ONLY_GUIDES: [&str; 2] = ["agentSessions", "tasks"];

/// Every area's guidance as one prompt section, for prompts that do not route
/// entities per turn. The search guide stays a `DescribeCodeTools` topic, as
/// it is SDK how-to rather than how an area works.
pub fn inline_guides(host: GuideHost) -> &'static str {
    fn render(host: GuideHost) -> String {
        sdk_documentation()
            .iter()
            .filter(|doc| doc.name != SEARCH_ENTITY)
            .filter(|doc| host == GuideHost::Code || !SDK_ONLY_GUIDES.contains(&doc.name.as_str()))
            .filter_map(|doc| {
                doc.guide
                    .as_deref()
                    .map(|guide| format!("\n# Macro {}\n{guide}\n", doc.name))
            })
            .collect()
    }
    static CODE: LazyLock<String> = LazyLock::new(|| render(GuideHost::Code));
    static DIRECT: LazyLock<String> = LazyLock::new(|| render(GuideHost::Direct));
    match host {
        GuideHost::Code => &CODE,
        GuideHost::Direct => &DIRECT,
    }
}

/// How the Jev relevance pass ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SelectionStatus {
    /// Jev ranked the catalog.
    Selected,
    /// No cognition service is configured.
    Unconfigured,
    /// The caller cancelled before Jev answered.
    Cancelled,
    /// Jev returned an error.
    ProviderError,
    /// Jev did not answer before the deadline.
    Timeout,
}

impl SelectionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Selected => "selected",
            Self::Unconfigured => "unconfigured",
            Self::Cancelled => "cancelled",
            Self::ProviderError => "provider_error",
            Self::Timeout => "timeout",
        }
    }
}

/// Questions Jev answers in one call.
const QUESTIONS_PER_CALL: usize = 32;
/// Parallel Jev calls per selection; entities past `MAX_CALLS * 32` are not
/// asked about and stay reachable through `DescribeCodeTools`.
const MAX_CALLS: usize = 8;

/// Ask Jev which entities help with `text`, at most 32 questions per call and
/// [`MAX_CALLS`] calls in parallel; most relevant first.
async fn rank_entities<'a>(
    user: &MacroUserIdStr<'static>,
    text: &str,
    docs: &'a [SdkDocumentation],
    cognition: Option<&Arc<dyn Cognition>>,
    deadline: Duration,
    cancel: &CancellationToken,
) -> (Vec<&'a SdkDocumentation>, SelectionStatus) {
    let Some(cognition) = cognition else {
        return (Vec::new(), SelectionStatus::Unconfigured);
    };
    let input = serde_json::json!({"userRequest": text.chars().take(8000).collect::<String>()});
    let calls = docs
        .chunks(QUESTIONS_PER_CALL)
        .take(MAX_CALLS)
        .map(|chunk| {
            cognition.decide(
                user,
                DecisionRequest {
                    input: input.clone(),
                    questions: chunk
                        .iter()
                        .map(|doc| {
                            (
                                doc.name.clone(),
                                format!(
                                    "Would the SDK entity {} help with this request? {}",
                                    doc.name, doc.description
                                ),
                            )
                        })
                        .collect(),
                },
            )
        });
    let answers = tokio::select! {
        biased;
        _ = cancel.cancelled() => return (Vec::new(), SelectionStatus::Cancelled),
        result = tokio::time::timeout(deadline, futures::future::join_all(calls)) => match result {
            Ok(answers) => answers,
            Err(_) => return (Vec::new(), SelectionStatus::Timeout),
        },
    };
    let mut probabilities = std::collections::BTreeMap::new();
    let mut answered = false;
    for answer in answers {
        match answer {
            Ok(answer) => {
                answered = true;
                probabilities.extend(answer.probabilities);
            }
            Err(error) => tracing::warn!(error = %error, "Jev could not rank SDK entities"),
        }
    }
    if !answered {
        return (Vec::new(), SelectionStatus::ProviderError);
    }
    let mut ranked: Vec<_> = docs
        .iter()
        .filter_map(|doc| {
            let score = probabilities.get(&doc.name).copied()?;
            (score.is_finite() && score >= 0.5).then_some((score, doc))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.name.cmp(&b.1.name)));
    (
        ranked.into_iter().map(|(_, doc)| doc).collect(),
        SelectionStatus::Selected,
    )
}

/// Load the entities a request needs, ranked by Jev, at most four: their
/// indexes, and with [`Guidance::Selected`] their guidance too. Failures retain
/// the compact catalog. The byte cap bounds prompt growth; it is not an exact
/// tokenizer count.
#[tracing::instrument(skip_all, fields(guidance = ?guidance, selected = tracing::field::Empty, bytes = tracing::field::Empty, selection_status = tracing::field::Empty, selected_entities = tracing::field::Empty))]
pub async fn select_documentation(
    user: &MacroUserIdStr<'static>,
    prompt: &str,
    cognition: Option<&Arc<dyn Cognition>>,
    guidance: Guidance,
    cancel: &CancellationToken,
) -> String {
    let docs = sdk_documentation();
    let mut output = String::from(
        "\n<macro_sdk>\nUse the real Macro SDK in ExecuteCode. Entity indexes below list each class, method and type by symbol, with method signatures. Read the symbols a program needs with ReadCodeDocs for their parameters, options and return types, all together in one call, unless their reference is already in context. Use DescribeCodeTools for the index of an entity not loaded here.\nAvailable entities:\n",
    );
    for doc in docs {
        output.push_str(&format!("{}: {}\n", doc.name, doc.description));
    }
    let started = tokio::time::Instant::now();
    let (ranked, status) = rank_entities(
        user,
        prompt,
        docs,
        cognition,
        Duration::from_millis(1000),
        cancel,
    )
    .await;
    let mut selected_entities = Vec::new();
    for doc in ranked.into_iter().take(4) {
        let Some(index) = doc.index.as_ref() else {
            continue;
        };
        let guide = match guidance {
            Guidance::Selected => doc.guide.as_deref(),
            Guidance::Inline => None,
        };
        let section = match guide {
            Some(guide) => format!("\n{index}\n{guide}\n"),
            None => format!("\n{index}"),
        };
        if output.len() + section.len() <= 48 * 1024 {
            output.push_str(&section);
            selected_entities.push(doc.name.as_str());
        }
    }
    let span = tracing::Span::current();
    span.record("selected", selected_entities.len());
    span.record("selected_entities", selected_entities.join(","));
    span.record("bytes", output.len());
    span.record("selection_status", status.as_str());
    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        selected = selected_entities.len(),
        bytes = output.len(),
        "selected SDK documentation"
    );
    output.push_str("</macro_sdk>\n");
    output
}

/// Budget for one documentation tool result. Claude Code moved an 87K
/// character response out of context into a file; reference Markdown tokenizes
/// densely, so stay well below that.
const DOCUMENTATION_BYTES: usize = 32 * 1024;

/// Every SDK entity Jev considers relevant to a described task.
#[derive(Clone, Serialize, JsonSchema)]
pub struct TaskDocumentation {
    /// How selection ended; anything but selected means no entity was chosen.
    pub status: SelectionStatus,
    /// Relevant entities, most relevant first, each with its index.
    pub entities: Vec<SdkDocumentation>,
    /// Relevant entities left out for size; request them by name.
    pub omitted: Vec<String>,
}

/// Select entity indexes for a task the agent describes, for clients that
/// never show the server the user's request.
#[tracing::instrument(name = "code_mode.task_documentation", skip_all, fields(selected = tracing::field::Empty, omitted = tracing::field::Empty, bytes = tracing::field::Empty, selection_status = tracing::field::Empty, selected_entities = tracing::field::Empty))]
pub async fn documentation_for_task(
    user: &MacroUserIdStr<'static>,
    task: &str,
    cognition: Option<&Arc<dyn Cognition>>,
    cancel: &CancellationToken,
) -> TaskDocumentation {
    let docs = sdk_documentation();
    // The agent is waiting on this call, unlike the per-turn prompt path.
    let (ranked, status) =
        rank_entities(user, task, docs, cognition, Duration::from_secs(5), cancel).await;
    let mut bytes = 0;
    let mut entities = Vec::new();
    let mut omitted = Vec::new();
    for doc in ranked {
        let size =
            doc.index.as_ref().map_or(0, String::len) + doc.guide.as_ref().map_or(0, String::len);
        if bytes + size <= DOCUMENTATION_BYTES {
            bytes += size;
            entities.push(doc.clone());
        } else {
            omitted.push(doc.name.clone());
        }
    }
    let span = tracing::Span::current();
    span.record("selected", entities.len());
    span.record("omitted", omitted.len());
    span.record("bytes", bytes);
    span.record("selection_status", status.as_str());
    span.record(
        "selected_entities",
        entities
            .iter()
            .map(|doc| doc.name.as_str())
            .collect::<Vec<_>>()
            .join(","),
    );
    TaskDocumentation {
        status,
        entities,
        omitted,
    }
}

/// One symbol's reference.
#[derive(Clone, Serialize, JsonSchema)]
pub struct SymbolReference {
    /// The symbol as requested.
    pub symbol: String,
    /// Its TypeDoc reference; symbols it names in backticks can be read too.
    pub reference: String,
}

/// The references for requested symbols, within one result's budget.
#[derive(Clone, Serialize, JsonSchema)]
pub struct SymbolReferences {
    /// References in request order.
    pub references: Vec<SymbolReference>,
    /// Requested symbols left out for size; request them again.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub omitted: Vec<String>,
    /// Requested symbols no index or reference names.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unknown: Vec<String>,
}

/// The references for `symbols`, in order, until they fill the budget.
#[tracing::instrument(name = "code_mode.read_symbols", skip_all, fields(requested = symbols.len(), read = tracing::field::Empty, unknown = tracing::field::Empty, bytes = tracing::field::Empty))]
pub fn read_symbols(symbols: &[String]) -> SymbolReferences {
    let mut bytes = 0;
    let mut result = SymbolReferences {
        references: Vec::new(),
        omitted: Vec::new(),
        unknown: Vec::new(),
    };
    for symbol in symbols {
        let Some(reference) = symbol_reference(symbol.trim()) else {
            result.unknown.push(symbol.clone());
            continue;
        };
        // The first reference is always returned; none is larger than the budget.
        if !result.references.is_empty() && bytes + reference.len() > DOCUMENTATION_BYTES {
            result.omitted.push(symbol.clone());
            continue;
        }
        bytes += reference.len();
        result.references.push(SymbolReference {
            symbol: symbol.clone(),
            reference: reference.to_owned(),
        });
    }
    let span = tracing::Span::current();
    span.record("read", result.references.len());
    span.record("unknown", result.unknown.len());
    span.record("bytes", bytes);
    result
}

#[cfg(test)]
mod test;
