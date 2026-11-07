//! Upstream automatic-link matching and transactional notifications.
mod creation;
mod edit;
use super::*;
use std::sync::{Arc, LazyLock};
/// A match in UTF-16 code units of the supplied text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkMatcherResult {
    /// Optional anchor and unlinked attributes.
    pub attributes: Option<AutoLinkAttributes>,
    /// Match start in code units.
    pub index: Utf16Offset,
    /// Match length in code units.
    pub length: u32,
    /// Replacement display text.
    pub text: String,
    /// Stored URL.
    pub url: String,
}
/// Stateless custom matcher; always search from the start of each supplied string.
pub trait LinkMatcher: Send + Sync {
    /// First match according to this matcher's policy.
    fn find(&self, text: &str) -> Option<LinkMatcherResult>;
}
/// Pure URL normalization policy.
pub type UrlTransformer = Arc<dyn Fn(&str) -> String + Send + Sync>;
/// Upstream regex matcher adapter; no global lastIndex is retained.
#[derive(Clone)]
pub struct RegexLinkMatcher {
    /// Compiled ECMAScript expression.
    pub regex: regress::Regex,
    /// Pure URL normalization function.
    pub url_transformer: UrlTransformer,
}
impl LinkMatcher for RegexLinkMatcher {
    fn find(&self, text: &str) -> Option<LinkMatcherResult> {
        let units: Vec<_> = text.encode_utf16().collect();
        let m = if self.regex.is_unicode() {
            self.regex.find_from_utf16(&units, 0).next()?
        } else {
            self.regex.find_from_ucs2(&units, 0).next()?
        };
        let text = String::from_utf16_lossy(&units[m.range()]);
        Some(LinkMatcherResult {
            attributes: None,
            index: Utf16Offset(m.start() as u32),
            length: (m.end() - m.start()) as u32,
            url: (self.url_transformer)(&text),
            text,
        })
    }
}
/// Build a regex adapter with identity URL normalization by default.
pub fn create_link_matcher_with_reg_exp(
    regex: regress::Regex,
    url_transformer: Option<UrlTransformer>,
) -> RegexLinkMatcher {
    RegexLinkMatcher {
        regex,
        url_transformer: url_transformer.unwrap_or_else(|| Arc::new(str::to_owned)),
    }
}
impl LinkMatcher for crate::utils::linkify::LinkifyIt {
    fn find(&self, text: &str) -> Option<LinkMatcherResult> {
        self.first_match(text).map(|m| LinkMatcherResult {
            attributes: None,
            index: Utf16Offset(m.index as u32),
            length: (m.last_index - m.index) as u32,
            text: m.text,
            url: m.url,
        })
    }
}
/// One automatic-link change, emitted only on a successful commit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AutoLinkChanged {
    /// New URL/attribute value, or None after unlinking.
    pub url: Option<String>,
    /// Previous value, or None when a link was created.
    pub prev_url: Option<String>,
}
/// Typed event replacing stored side-effecting onChange callbacks.
pub static AUTO_LINK_CHANGED: EventKey<AutoLinkChanged> = EventKey::new("autolink.changed");
/// Parent exclusion predicate; receives the model view and immediate parent.
pub type ExcludeParent = fn(StateRef<'_>, NodeKey) -> bool;
/// Per-editor automatic-link configuration.
#[derive(Clone)]
pub struct AutoLinkConfig {
    /// Parent types in which automatic linking is disabled.
    pub exclude_parents: Vec<ExcludeParent>,
    /// Matchers tried in configuration order, rather than earliest-match order.
    pub matchers: Vec<Arc<dyn LinkMatcher>>,
    /// Tested against one UTF-16 unit; absent units are JS string "undefined".
    pub separator_regex: regress::Regex,
}
static SEPARATOR: LazyLock<regress::Regex> =
    LazyLock::new(|| regress::Regex::new(r"[.,;\s]").expect("upstream separator"));
impl Default for AutoLinkConfig {
    fn default() -> Self {
        Self {
            exclude_parents: Vec::new(),
            matchers: Vec::new(),
            separator_regex: SEPARATOR.clone(),
        }
    }
}
impl AutoLinkConfig {
    /// Concatenate parent exclusions and matchers; override the separator expression.
    pub fn merge(&self, overrides: Self) -> Self {
        Self {
            exclude_parents: self
                .exclude_parents
                .iter()
                .chain(&overrides.exclude_parents)
                .copied()
                .collect(),
            matchers: self
                .matchers
                .iter()
                .chain(&overrides.matchers)
                .cloned()
                .collect(),
            separator_regex: overrides.separator_regex,
        }
    }
}
fn changed(tx: &mut Transaction<'_>, url: Option<String>, prev_url: Option<String>) {
    tx.emit(&AUTO_LINK_CHANGED, AutoLinkChanged { url, prev_url });
}
fn first_match(text: &str, cfg: &AutoLinkConfig) -> Option<LinkMatcherResult> {
    cfg.matchers.iter().find_map(|m| m.find(text))
}
fn is_separator(unit: Option<u16>, regex: &regress::Regex) -> bool {
    match unit {
        Some(unit) => regex.find_from_ucs2(&[unit], 0).next().is_some(),
        None => regex.find("undefined").is_some(),
    }
}
fn starts_separator(text: &str, cfg: &AutoLinkConfig) -> bool {
    is_separator(text.encode_utf16().next(), &cfg.separator_regex)
}
fn ends_separator(text: &str, cfg: &AutoLinkConfig) -> bool {
    is_separator(text.encode_utf16().last(), &cfg.separator_regex)
}
fn simple(st: &impl Read, node: NodeKey) -> bool {
    st.is_simple_text(node)
}
fn linked(st: &impl Read, node: NodeKey) -> bool {
    st.get::<AutoLinkNode>(node).is_some_and(|n| !n.is_unlinked)
}
fn neighbor_valid(st: &impl Read, node: NodeKey, previous: bool, cfg: &AutoLinkConfig) -> bool {
    let sibling = if previous {
        st.prev_sibling(node)
    } else {
        st.next_sibling(node)
    };
    let sibling = sibling.and_then(|key| {
        if st.is_element(key) {
            if previous {
                st.last_descendant(key)
            } else {
                st.first_descendant(key)
            }
        } else {
            Some(key)
        }
    });
    sibling.is_none_or(|key| {
        st.is_line_break(key)
            || st.is_text(key)
                && if previous {
                    ends_separator(&st.text_content(key), cfg)
                } else {
                    starts_separator(&st.text_content(key), cfg)
                }
    })
}
fn replace_with_children(tx: &mut Transaction<'_>, node: NodeKey) -> Result<Vec<NodeKey>> {
    let children = tx.children_keys(node)?;
    for &child in children.iter().rev() {
        tx.insert_after(node, child, true)?;
    }
    tx.remove(node, false)?;
    Ok(children)
}
/// Text transform: maintain enclosing automatic links or create links in eligible siblings.
pub fn auto_link_text_transform(tx: &mut Transaction<'_>, text: Id<Text>) -> Result<()> {
    let cfg = tx.extension::<AutoLinkConfig>()?.clone();
    let Some(parent) = tx.parent(text) else {
        return Ok(());
    };
    if tx.is::<AutoLinkNode>(parent) {
        edit::handle_link_edit(tx, parent, &cfg)?;
    } else if !tx.is::<LinkNode>(parent)
        && !cfg
            .exclude_parents
            .iter()
            .any(|exclude| exclude(tx.view(), parent))
    {
        let previous = tx.prev_sibling(text);
        if simple(tx, text.key())
            && (starts_separator(&tx.text_content(text), &cfg)
                || !previous.is_some_and(|p| tx.is::<AutoLinkNode>(p)))
        {
            let mut nodes = vec![text.key()];
            for sibling in tx.next_siblings(text) {
                if !simple(tx, sibling) {
                    break;
                }
                nodes.push(sibling);
                if tx
                    .text_content(sibling)
                    .chars()
                    .any(crate::utils::is_js_whitespace)
                {
                    break;
                }
            }
            creation::handle_link_creation(tx, &nodes, &cfg)?;
        }
        edit::handle_bad_neighbors(tx, text.key(), &cfg)?;
    }
    Ok(())
}
/// Null TOGGLE_LINK listener half: flip unlinked on extracted automatic-link parents.
pub fn toggle_auto_link_unlinked(tx: &mut Transaction<'_>) -> Result<()> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(());
    }
    for node in tx.extract_at(SelectionSlot::Active)? {
        if let Some(parent) = tx.parent(node).filter(|p| tx.is::<AutoLinkNode>(*p)) {
            let unlinked = tx
                .get::<AutoLinkNode>(parent)
                .ok_or(Error::NodeTypeMismatch(parent))?
                .is_unlinked;
            tx.get_mut::<AutoLinkNode>(parent)?.is_unlinked = !unlinked;
            tx.mark_dirty(parent)?;
        }
    }
    Ok(())
}
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&super::TOGGLE_LINK),
    priority: CommandPriority::Low,
    placement: Placement::After,
}];
struct AutoLinkCommands;
impl Plugin for AutoLinkCommands {
    fn name(&self) -> &'static str {
        "autolink"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled> {
        if let Command::Extension(command) = command
            && matches!(
                command.payload(&super::TOGGLE_LINK),
                Some(ToggleLinkPayload::Remove)
            )
        {
            toggle_auto_link_unlinked(tx)?;
        }
        Ok(Handled::No)
    }
}
/// Register AutoLinkNode, configuration, its Text transform and null-toggle listener.
pub fn register_auto_link(b: EditorBuilder, config: AutoLinkConfig) -> EditorBuilder {
    b.node::<AutoLinkNode>()
        .extension_state(config)
        .transform::<Text>(auto_link_text_transform)
        .plugin(AutoLinkCommands)
}
#[cfg(test)]
mod test;
