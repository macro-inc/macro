//! Typed package command identities and their low-priority listener.
use super::*;
/// Insert an ordered list.
pub static INSERT_ORDERED_LIST: CommandKey<()> = CommandKey::new("list.insert_ordered");
/// Insert an unordered list.
pub static INSERT_UNORDERED_LIST: CommandKey<()> = CommandKey::new("list.insert_unordered");
/// Insert a checklist.
pub static INSERT_CHECK_LIST: CommandKey<()> = CommandKey::new("list.insert_check");
/// Remove selected lists.
pub static REMOVE_LIST: CommandKey<()> = CommandKey::new("list.remove");
/// Set a numbered list's start.
pub static UPDATE_LIST_START: CommandKey<UpdateListStart> = CommandKey::new("list.update_start");
/// Integer numbering payload, matching the list node's serialized contract.
#[derive(Clone, Copy, Debug)]
pub struct UpdateListStart {
    /// List to update.
    pub list: NodeKey,
    /// New first value.
    pub new_start: i32,
}
static COMMANDS: [CommandRegistration; 5] = [
    CommandRegistration {
        command: CommandKind::Extension(&INSERT_ORDERED_LIST),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&INSERT_UNORDERED_LIST),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&INSERT_CHECK_LIST),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&REMOVE_LIST),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&UPDATE_LIST_START),
        priority: CommandPriority::Low,
        placement: Placement::After,
    },
];
pub(super) struct ListCommands;
impl Plugin for ListCommands {
    fn name(&self) -> &'static str {
        "list"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if command.payload(&INSERT_ORDERED_LIST).is_some() {
            format::insert_list(tx, ListType::Number)?;
        } else if command.payload(&INSERT_UNORDERED_LIST).is_some() {
            format::insert_list(tx, ListType::Bullet)?;
        } else if command.payload(&INSERT_CHECK_LIST).is_some() {
            format::insert_list(tx, ListType::Check)?;
        } else if command.payload(&REMOVE_LIST).is_some() {
            format::remove_list(tx)?;
        } else if let Some(payload) = command.payload(&UPDATE_LIST_START) {
            return Ok(
                if register::update_list_start(tx, payload.list, payload.new_start)? {
                    Handled::Yes
                } else {
                    Handled::No
                },
            );
        } else {
            return Ok(Handled::No);
        }
        Ok(Handled::Yes)
    }
}
