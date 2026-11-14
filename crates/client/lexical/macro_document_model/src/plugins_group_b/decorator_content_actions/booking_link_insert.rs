//! Source INSERT_BOOKING_LINK_MENTION (mentionsPlugin.ts:746-760): insert at the
//! selection current at dispatch, wrap in a paragraph at the root, select the end.
use crate::nodes::{BookingLinkMentionNode, Maybe, create_booking_link_mention_node};
use lexical_model::*;

/// Mirrors Source BookingLinkMentionInfo as handleBookingLinkMention sends it:
/// `url` is always present (buildBookingUrl); absent slug and label stay
/// absent, and '' is kept.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    profile_id: String,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    label: Option<String>,
    url: String,
}

#[derive(Clone, Debug)]
struct Insert {
    input: Input,
    generation: u32,
}
static INSERT: CommandKey<Insert> = CommandKey::new("group-b.insert-booking-link-mention");

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != INSERT.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT,
        Insert {
            input: serde_json::from_str(json)?,
            generation,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(BookingLinkInsertion)
}

struct BookingLinkInsertion;
impl Plugin for BookingLinkInsertion {
    fn name(&self) -> &'static str {
        "group-b.booking-link-insertion"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&INSERT),
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&INSERT) else {
            return Ok(Handled::No);
        };
        if command.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let input = &command.input;
        // The existing constructor captures the node host and fills an empty
        // url as the Source constructor does; Source always sends one.
        let mention = create_booking_link_mention_node(
            tx,
            BookingLinkMentionNode {
                profile_id: Maybe::Value(input.profile_id.clone()),
                slug: input.slug.clone().map_or(Maybe::Missing, Maybe::Value),
                label: input.label.clone().map_or(Maybe::Missing, Maybe::Value),
                url: input.url.clone(),
                host: None,
            },
        )?
        .key();
        // $insertNodes replaces an expanded range and falls back to the root end.
        tx.insert_nodes_at_selection(&[mention])?;
        let parent = tx.parent_or_err(mention)?;
        if tx.is_root_or_shadow_root(parent) {
            lexical_rich_nodes::utils::wrap_node_in_element(tx, mention, |tx| {
                Ok(tx.create(Paragraph::default())?.key())
            })?;
        }
        // A decorator's selectEnd is selectNext(0, 0).
        tx.select_next(mention, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        Ok(Handled::Yes)
    }
}
