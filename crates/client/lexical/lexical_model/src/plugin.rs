//! Static command listeners and bounded shared/conditional post-commit rounds.
use crate::collections::IndexMap;
use crate::*;
use std::sync::Arc;
/// One isolated follow-up: true publishes it; false discards all staged changes.
/// Allocated keys remain consumed even when the transaction is discarded.
pub type ConditionalUpdate<'a> = Box<dyn FnOnce(&mut Transaction<'_>) -> Result<bool, Error> + 'a>;
/// Immutable extension behavior; mutable state belongs in ExtensionState.
pub trait Plugin: Send + Sync + 'static {
    /// Diagnostic name.
    fn name(&self) -> &'static str;
    /// Command subscriptions, read once at build.
    fn commands(&self) -> &[CommandRegistration];
    /// Handle one subscribed command.
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error>;
    /// Prepare an isolated update after the shared hooks, borrowing committed facts.
    /// Return None when no follow-up is needed. False drops the update, including
    /// any early flushes; true commits it through the normal bounded hook rounds.
    fn conditional_after_commit<'a>(
        &'a self,
        _commit: &'a Commit,
    ) -> Option<ConditionalUpdate<'a>> {
        None
    }
    /// Queue an update in the shared follow-up transaction after a commit.
    fn after_commit(&self, _tx: &mut Transaction<'_>, _commit: &Commit) -> Result<(), Error> {
        Ok(())
    }
    /// Optional speculative follow-up, isolated from shared plugin writes.
    fn isolated_after_commit(&self) -> Option<&dyn IsolatedAfterCommit> {
        None
    }
}
/// A follow-up whose declined edits must be discarded, such as Markdown shortcuts.
pub trait IsolatedAfterCommit: Send + Sync {
    /// Return true to publish this transaction; false discards every staged write.
    fn apply(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<bool, Error>;
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
pub(crate) const PRIORITIES: [CommandPriority; 5] = [
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
    pub(crate) priority: CommandPriority,
    pub(crate) plugin: Arc<dyn Plugin>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_id: Option<ForeignListenerId>,
}
pub(crate) type Listeners = IndexMap<CommandKind, Vec<Arc<Listener>>>;
pub(crate) fn insert_listener(
    lists: &mut Listeners,
    registration: CommandRegistration,
    listener: Listener,
) {
    let list = lists.entry(registration.command).or_default();
    let index = list
        .iter()
        .position(|l| {
            l.priority < registration.priority
                || (registration.placement == Placement::Before
                    && l.priority == registration.priority)
        })
        .unwrap_or(list.len());
    list.insert(index, Arc::new(listener));
}
pub(crate) fn listener_table(lists: &Listeners) -> ListenerTable {
    let mut table = ListenerTable::default();
    for (kind, list) in lists {
        for listener in list {
            table.0.entry(*kind).or_default().0 |= 1 << listener.priority as u8;
        }
    }
    table
}
pub(crate) fn listeners(plugins: &[Arc<dyn Plugin>]) -> (Listeners, ListenerTable) {
    let mut lists = Listeners::default();
    for plugin in plugins {
        for registration in plugin.commands() {
            insert_listener(
                &mut lists,
                *registration,
                Listener {
                    priority: registration.priority,
                    plugin: plugin.clone(),
                    #[cfg(feature = "foreign-nodes")]
                    foreign_id: None,
                },
            );
        }
    }
    let table = listener_table(&lists);
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
    #[cfg(not(feature = "foreign-nodes"))]
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
    /// Run bounded shared and conditional follow-ups, retaining published main commits.
    /// s2: TF-08
    pub fn run_after_commit(&mut self, mut commit: Commit) -> Commit {
        let plugins = self.plugins.clone();
        if plugins.is_empty() {
            return commit;
        }
        fn append_prior<'commit>(
            commit: &'commit Commit,
            prior: &mut smallvec::SmallVec<[&'commit Commit; 1]>,
        ) {
            if let Some(preceding) = commit.preceding.as_deref() {
                append_prior(preceding, prior);
            }
            if !commit.is_noop() {
                prior.push(commit);
            }
            for following in &commit.following {
                append_prior(following, prior);
            }
        }
        let mut previous_range: Option<std::ops::Range<usize>> = None;
        let isolated: Vec<_> = plugins
            .iter()
            .filter_map(|plugin| {
                plugin
                    .isolated_after_commit()
                    .map(|hook| (plugin.name(), hook))
            })
            .collect();
        let mut rounds = 0;
        loop {
            let mut previous = smallvec::SmallVec::<[&Commit; 1]>::new();
            if let Some(range) = previous_range.take() {
                for following in &commit.following[range] {
                    append_prior(following, &mut previous);
                }
            } else {
                append_prior(&commit, &mut previous);
            }
            if previous.is_empty() {
                break;
            }
            let state = self.state.clone();
            let extensions = self.extensions.clone();
            let tags = self.carried_tags.clone();
            let composition = self.composition_key;
            #[cfg(feature = "foreign-nodes")]
            let publication_cutoff = self.suspend_version;
            let rollback = |editor: &mut Editor| {
                editor.state = state.clone();
                editor.extensions = extensions.clone();
                editor.carried_tags = tags.clone();
                editor.composition_key = composition;
                #[cfg(feature = "foreign-nodes")]
                if let Some(observer) = &editor.foreign_publication_observer {
                    observer.rolled_back(&editor.state, publication_cutoff);
                }
            };
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
                drop(tx);
                rollback(self);
                drop(previous);
                commit.follow_up_error = Some(error);
                break;
            }
            // Check the guard before publishing the would-be hundredth round.
            if rounds >= 99
                && (!tx.dirty_leaves.is_empty()
                    || !tx.dirty_elements.is_empty()
                    || tx.selection_dirty
                    || !tx.events.is_empty()
                    || !tx.nested.is_empty()
                    || tx.preceding.is_some())
            {
                drop(tx);
                rollback(self);
                drop(previous);
                commit.follow_up_error = Some(FollowUpError {
                    plugin: "follow-up",
                    error: Arc::new(Error::EndlessFollowUps),
                });
                break;
            }
            let following = match tx.commit() {
                Ok(next) => next,
                Err(error) => {
                    rollback(self);
                    drop(previous);
                    commit.follow_up_error = Some(FollowUpError {
                        plugin: "pipeline",
                        error: Arc::new(error),
                    });
                    break;
                }
            };
            let mut following = if following.is_noop() {
                vec![]
            } else {
                vec![following]
            };
            'conditional: for prior in &previous {
                for plugin in &plugins {
                    let Some(update) = plugin.conditional_after_commit(prior) else {
                        continue;
                    };
                    match self.conditional_update(update) {
                        Ok(Some(next)) if next.chain().any(|entry| !entry.is_noop()) => {
                            following.push(next)
                        }
                        Ok(_) => {}
                        Err(error) => {
                            failed = Some(FollowUpError {
                                plugin: plugin.name(),
                                error: Arc::new(error),
                            });
                            break 'conditional;
                        }
                    }
                }
            }
            if let Some(error) = failed {
                rollback(self);
                drop(previous);
                commit.follow_up_error = Some(error);
                break;
            }
            if rounds >= 99 && !following.is_empty() {
                rollback(self);
                drop(previous);
                commit.follow_up_error = Some(FollowUpError {
                    plugin: "follow-up",
                    error: Arc::new(Error::EndlessFollowUps),
                });
                break;
            }
            // Keep each prior's following/preceding structure unchanged through
            // all phases. Attach the accepted round only after its borrows end.
            let mut isolated_failure = None;
            'isolated: for prior in &previous {
                for (name, hook) in &isolated {
                    let state = self.state.clone();
                    let extensions = self.extensions.clone();
                    let tags = self.carried_tags.clone();
                    let composition = self.composition_key;
                    #[cfg(feature = "foreign-nodes")]
                    let publication_cutoff = self.suspend_version;
                    let restore = |editor: &mut Editor| {
                        editor.state = state;
                        editor.extensions = extensions;
                        editor.carried_tags = tags;
                        editor.composition_key = composition;
                        #[cfg(feature = "foreign-nodes")]
                        if let Some(observer) = &editor.foreign_publication_observer {
                            observer.rolled_back(&editor.state, publication_cutoff);
                        }
                    };
                    let mut tx = self.transaction();
                    match hook.apply(&mut tx, prior) {
                        Ok(false) => {
                            drop(tx);
                            restore(self);
                            continue;
                        }
                        Ok(true) => {}
                        Err(error) => {
                            drop(tx);
                            restore(self);
                            isolated_failure = Some(FollowUpError {
                                plugin: name,
                                error: Arc::new(error),
                            });
                            break 'isolated;
                        }
                    }
                    if rounds >= 99
                        && (!tx.dirty_leaves.is_empty()
                            || !tx.dirty_elements.is_empty()
                            || tx.selection_dirty
                            || !tx.events.is_empty()
                            || !tx.nested.is_empty()
                            || tx.preceding.is_some())
                    {
                        drop(tx);
                        restore(self);
                        isolated_failure = Some(FollowUpError {
                            plugin: "follow-up",
                            error: Arc::new(Error::EndlessFollowUps),
                        });
                        break 'isolated;
                    }
                    let next = match tx.commit() {
                        Ok(next) => next,
                        Err(error) => {
                            restore(self);
                            isolated_failure = Some(FollowUpError {
                                plugin: name,
                                error: Arc::new(error),
                            });
                            break 'isolated;
                        }
                    };
                    if !next.is_noop() {
                        following.push(next);
                    }
                }
            }
            drop(previous);
            let start = commit.following.len();
            commit.following.extend(following);
            if let Some(error) = isolated_failure {
                commit.follow_up_error = Some(error);
                break;
            }
            if start == commit.following.len() {
                break;
            }
            previous_range = Some(start..commit.following.len());
            rounds += 1;
        }
        commit
    }
    fn conditional_update(
        &mut self,
        update: ConditionalUpdate<'_>,
    ) -> Result<Option<Commit>, Error> {
        let state = self.state.clone();
        let extensions = self.extensions.clone();
        let tags = self.carried_tags.clone();
        let composition = self.composition_key;
        #[cfg(feature = "foreign-nodes")]
        let publication_cutoff = self.suspend_version;
        let mut tx = self.transaction();
        let result = match update(&mut tx) {
            Ok(true) => tx.commit().map(Some),
            result => {
                drop(tx);
                result.map(|_| None)
            }
        };
        if !matches!(&result, Ok(Some(_))) {
            self.state = state;
            self.extensions = extensions;
            self.carried_tags = tags;
            self.composition_key = composition;
            #[cfg(feature = "foreign-nodes")]
            if let Some(observer) = &self.foreign_publication_observer {
                observer.rolled_back(&self.state, publication_cutoff);
            }
        }
        result
    }
    /// Drain build-time follow-up commits once.
    pub fn take_initial_commits(&mut self) -> Vec<Commit> {
        self.initial_diff = None;
        std::mem::take(&mut self.initial_commits)
    }
}
#[cfg(test)]
mod after_commit_test;
#[cfg(test)]
mod test;
