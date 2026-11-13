//! What the service reads from an authorship note (`authorship/3.0.0`): the
//! sessions that wrote lines of the commit. A note is line attestations, a
//! `---` line, then JSON whose `sessions` map is keyed by git-ai session id
//! (`s_…`, attribute 24) with `agent_id.id` = the agent's own session id
//! (attribute 23). Older notes key a `prompts` map by a 16-hex prompt hash
//! instead.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// A session named in a note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoteSession {
    /// git-ai session id (`s_…`) or, in older notes, the prompt hash.
    pub session_id: String,
    /// Agent.
    pub tool: Option<String>,
    /// The agent's own session id.
    pub external_session_id: Option<String>,
    /// Model.
    pub model: Option<String>,
}

#[derive(Deserialize)]
struct NoteMetadata {
    #[serde(default)]
    sessions: BTreeMap<String, NoteAgent>,
    #[serde(default)]
    prompts: BTreeMap<String, NoteAgent>,
}

#[derive(Deserialize)]
struct NoteAgent {
    agent_id: Option<AgentId>,
}

#[derive(Deserialize)]
struct AgentId {
    tool: Option<String>,
    id: Option<String>,
    model: Option<String>,
}

const METADATA_SEPARATOR: &str = "\n---\n";

/// The sessions a note names, ordered by id. Empty for a human-only note or
/// one that does not parse; the note itself is stored either way.
pub fn note_sessions(note: &str) -> Vec<NoteSession> {
    let Some((_, metadata)) = note.rsplit_once(METADATA_SEPARATOR) else {
        return Vec::new();
    };
    let Ok(metadata) = serde_json::from_str::<NoteMetadata>(metadata) else {
        return Vec::new();
    };

    metadata
        .sessions
        .into_iter()
        .chain(metadata.prompts)
        .map(|(session_id, agent)| {
            let agent = agent.agent_id;
            NoteSession {
                session_id,
                tool: agent.as_ref().and_then(|a| a.tool.clone()),
                external_session_id: agent.as_ref().and_then(|a| a.id.clone()),
                model: agent.and_then(|a| a.model),
            }
        })
        .collect()
}
