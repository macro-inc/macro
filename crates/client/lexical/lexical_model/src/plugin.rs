//! Static command listeners and bounded, shared post-commit rounds.
use crate::collections::IndexMap;
use crate::*;
use std::sync::Arc;
/// Immutable extension behavior; mutable state belongs in ExtensionState.
pub trait Plugin: Send + Sync + 'static {
    /// Diagnostic name.
    fn name(&self) -> &'static str;
    /// Command subscriptions, read once at build.
    fn commands(&self) -> &[CommandRegistration];
    /// Handle one subscribed command.
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error>;
    /// Queue an update in the shared follow-up transaction after a commit.
    fn after_commit(&self, _tx: &mut Transaction<'_>, _commit: &Commit) -> Result<(), Error> {
        Ok(())
    }
}
/// Whether propagation stops.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Handled {
    /// Stop propagation.
    Yes,
    /// Continue propagation.
    No,
}
/// Higher priorities execute first.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Hash)]
pub enum CommandPriority {
    /// Editor defaults.
    Editor = 0,
    /// Low priority.
    Low = 1,
    /// Normal priority.
    Normal = 2,
    /// High priority.
    High = 3,
    /// Critical priority.
    Critical = 4,
}
const PRIORITIES: [CommandPriority; 5] = [
    CommandPriority::Critical,
    CommandPriority::High,
    CommandPriority::Normal,
    CommandPriority::Low,
    CommandPriority::Editor,
];
/// Placement within a priority level.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Placement {
    /// Prepend (newest first).
    Before,
    /// Append (oldest first).
    After,
}
/// One static command subscription.
#[derive(Clone, Copy, Debug)]
pub struct CommandRegistration {
    /// Listener list.
    pub command: CommandKind,
    /// Dispatch priority.
    pub priority: CommandPriority,
    /// Placement at that level.
    pub placement: Placement,
}
/// Bits for the five priority levels of a command.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct PriorityLevels(u8);
impl PriorityLevels {
    /// Whether a level has listeners.
    pub fn contains(self, priority: CommandPriority) -> bool {
        self.0 & (1 << priority as u8) != 0
    }
    /// First level visited during dispatch.
    pub fn highest(self) -> Option<CommandPriority> {
        PRIORITIES.into_iter().find(|p| self.contains(*p))
    }
    /// Raw priority bit set.
    pub fn bits(self) -> u8 {
        self.0
    }
}
/// First-registration-ordered command priorities exposed to the host.
#[derive(Clone, Debug, Default)]
pub struct ListenerTable(IndexMap<CommandKind, PriorityLevels>);
impl ListenerTable {
    /// Levels for a subscribed command.
    pub fn levels(&self, kind: CommandKind) -> Option<PriorityLevels> {
        self.0.get(&kind).copied()
    }
    /// Commands in first-registration order.
    pub fn iter(&self) -> impl Iterator<Item = (CommandKind, PriorityLevels)> + '_ {
        self.0.iter().map(|(kind, levels)| (*kind, *levels))
    }
}
#[derive(Clone)]
pub(crate) struct Listener {
    priority: CommandPriority,
    plugin: Arc<dyn Plugin>,
}
pub(crate) type Listeners = IndexMap<CommandKind, Vec<Listener>>;
pub(crate) fn listeners(plugins: &[Arc<dyn Plugin>]) -> (Listeners, ListenerTable) {
    let mut lists = Listeners::default();
    let mut table = ListenerTable::default();
    for plugin in plugins {
        for registration in plugin.commands() {
            table.0.entry(registration.command).or_default().0 |= 1 << registration.priority as u8;
            let list = lists.entry(registration.command).or_default();
            let listener = Listener {
                priority: registration.priority,
                plugin: plugin.clone(),
            };
            let index = list
                .iter()
                .position(|l| {
                    l.priority < registration.priority
                        || (registration.placement == Placement::Before
                            && l.priority == registration.priority)
                })
                .unwrap_or(list.len());
            list.insert(index, listener);
        }
    }
    (lists, table)
}
impl EditorBuilder {
    /// Install an immutable plugin in registration order.
    pub fn plugin(mut self, plugin: impl Plugin) -> Self {
        self.plugins.push(Arc::new(plugin));
        self
    }
    /// Parse a state and run the initial all-created hook pass at build.
    pub fn initial_state(mut self, state: SerializedEditorState) -> Self {
        self.initial_state = Some(state);
        self
    }
}
impl Transaction<'_> {
    /// Dispatch all subscribed levels inline, without flushing between them.
    /// s2: CMD-03, CMD-04
    pub fn dispatch(&mut self, command: &Command) -> Result<Handled, Error> {
        self.dispatch_inner(command, false)
    }
    pub(crate) fn dispatch_inner(
        &mut self,
        command: &Command,
        flush_levels: bool,
    ) -> Result<Handled, Error> {
        let list = self
            .editor
            .listeners
            .get(&command.kind())
            .cloned()
            .unwrap_or_default();
        let mut previous_level = None;
        for listener in list {
            if flush_levels && previous_level.is_some_and(|priority| priority != listener.priority)
            {
                self.flush()?;
            }
            previous_level = Some(listener.priority);
            if listener.plugin.handle(self, command)? == Handled::Yes {
                return Ok(Handled::Yes);
            }
        }
        Ok(Handled::No)
    }
    /// Stage a host preventDefault effect.
    pub fn prevent_default(&mut self) {
        self.default_prevented = true;
    }
}
/// A failed post-commit round. Earlier commits remain published.
#[derive(Clone, Debug)]
pub struct FollowUpError {
    /// Plugin that failed, or the pipeline/guard.
    pub plugin: &'static str,
    /// Error retained without cloning its provider payload.
    pub error: Arc<Error>,
}
impl Editor {
    /// Configured platform context.
    pub fn view_host(&self) -> ViewHost {
        self.view_host
    }
    /// Subscribed command levels.
    pub fn listener_table(&self) -> &ListenerTable {
        &self.listener_table
    }
    /// Dispatch from outside an update, flushing after every unhandled level.
    pub fn dispatch(&mut self, command: &Command) -> Result<(Handled, Commit), Error> {
        if self.listener_table.levels(command.kind()).is_none() {
            return Ok((Handled::No, self.noop_commit()));
        }
        let mut tx = self.transaction();
        let handled = tx.dispatch_inner(command, true)?;
        let commit = tx.commit()?;
        Ok((handled, self.run_after_commit(commit)))
    }
    /// Run shared follow-up transactions, capturing failures after published commits.
    /// s2: TF-08
    pub fn run_after_commit(&mut self, mut commit: Commit) -> Commit {
        let plugins = self.plugins.clone();
        if plugins.is_empty() {
            return commit;
        }
        let mut previous = commit
            .chain()
            .filter(|c| !c.is_noop())
            .cloned()
            .collect::<Vec<_>>();
        let mut rounds = 0;
        while !previous.is_empty() {
            let mut tx = self.transaction();
            let mut failed = None;
            for prior in &previous {
                for plugin in &plugins {
                    if let Err(error) = plugin.after_commit(&mut tx, prior) {
                        failed = Some(FollowUpError {
                            plugin: plugin.name(),
                            error: Arc::new(error),
                        });
                        break;
                    }
                }
                if failed.is_some() {
                    break;
                }
            }
            if let Some(error) = failed {
                commit.follow_up_error = Some(error);
                break;
            }
            // Check the guard before publishing the would-be hundredth round.
            if rounds == 99
                && (!tx.dirty_leaves.is_empty()
                    || !tx.dirty_elements.is_empty()
                    || tx.selection_dirty
                    || !tx.events.is_empty())
            {
                commit.follow_up_error = Some(FollowUpError {
                    plugin: "follow-up",
                    error: Arc::new(Error::EndlessFollowUps),
                });
                break;
            }
            let following = match tx.commit() {
                Ok(next) => next,
                Err(error) => {
                    commit.follow_up_error = Some(FollowUpError {
                        plugin: "pipeline",
                        error: Arc::new(error),
                    });
                    break;
                }
            };
            if following.is_noop() {
                break;
            }
            rounds += 1;
            previous = following
                .chain()
                .filter(|c| !c.is_noop())
                .cloned()
                .collect();
            commit.following.push(following);
        }
        commit
    }
    /// Drain build-time follow-up commits once.
    pub fn take_initial_commits(&mut self) -> Vec<Commit> {
        std::mem::take(&mut self.initial_commits)
    }
}
#[cfg(test)]
mod test;
