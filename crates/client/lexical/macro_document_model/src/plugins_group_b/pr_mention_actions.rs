//! Admit asynchronous PR display enrichment against the captured mention.
use super::*;
use crate::nodes::{Maybe, PullRequestMentionNode, is_github_pull_request_url};

#[derive(Clone, Debug, serde::Deserialize)]
struct PrEnrichment {
    key: u32,
    expected: PullRequestMentionNode,
    label: Option<String>,
    url: Option<String>,
}

#[derive(Clone, Debug)]
struct PrCommand {
    key: NodeKey,
    update: PrEnrichment,
}

static ENRICH: CommandKey<PrCommand> = CommandKey::new("group-b.pr-enrich");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&ENRICH),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != ENRICH.name() {
        return Ok(None);
    }
    let update: PrEnrichment = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &ENRICH,
        PrCommand {
            key: NodeKey::from_parts(KeyParts {
                index: update.key,
                generation,
            }),
            update,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(PrActions)
}

struct PrActions;

impl Plugin for PrActions {
    fn name(&self) -> &'static str {
        "group-b.pr-enrichment"
    }

    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = command.payload(&ENRICH) else {
            return Ok(Handled::No);
        };
        let Some(current) = tx
            .get::<PullRequestMentionNode>(command.key)
            .filter(|_| tx.is_attached(command.key))
        else {
            return Ok(Handled::No);
        };
        if current != &command.update.expected {
            return Ok(Handled::No);
        }
        let label =
            command.update.label.as_ref().filter(|label| {
                !label.is_empty() && current.label.as_deref() != Some(label.as_str())
            });
        // Source only adds a resolved URL when the rendered mention has none.
        let url = command.update.url.as_ref().filter(|url| {
            current.url.as_deref().is_none_or(str::is_empty) && is_github_pull_request_url(url)
        });
        if label.is_none() && url.is_none() {
            return Ok(Handled::No);
        }
        let mut target = tx.get_mut::<PullRequestMentionNode>(command.key)?;
        if let Some(label) = label {
            target.label = Maybe::Value(label.clone());
        }
        if let Some(url) = url {
            target.url = Maybe::Value(url.clone());
        }
        tx.add_tag(UpdateTag::Historic);
        tx.add_tag(UpdateTag::SkipDomSelection);
        tx.add_tag(UpdateTag::SkipScrollIntoView);
        Ok(Handled::Yes)
    }
}
