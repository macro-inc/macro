use lexical_model::*;
/// Interaction that may reset typing formats.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EscapeFormatTrigger {
    /// Enter key.
    Enter,
    /// Pointer click.
    Click,
    /// Arrow key.
    Arrow,
    /// Space key.
    Space,
    /// Tab key.
    Tab,
}
/// Per-format trigger overrides; absence preserves a value during config merging.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TriggerConfig {
    /// Reset on Enter.
    pub enter: Option<bool>,
    /// Reset on click.
    pub click: Option<bool>,
    /// Reset on arrow navigation.
    pub arrow: Option<bool>,
    /// Reset on Space.
    pub space: Option<bool>,
    /// Reset on Tab.
    pub tab: Option<bool>,
    /// Require a collapsed text caret at an exposed node boundary.
    pub only_at_boundary: Option<bool>,
}
impl TriggerConfig {
    fn merge(self, other: Self) -> Self {
        Self {
            enter: other.enter.or(self.enter),
            click: other.click.or(self.click),
            arrow: other.arrow.or(self.arrow),
            space: other.space.or(self.space),
            tab: other.tab.or(self.tab),
            only_at_boundary: other.only_at_boundary.or(self.only_at_boundary),
        }
    }
    fn enabled(self, trigger: EscapeFormatTrigger) -> bool {
        match trigger {
            EscapeFormatTrigger::Enter => self.enter,
            EscapeFormatTrigger::Click => self.click,
            EscapeFormatTrigger::Arrow => self.arrow,
            EscapeFormatTrigger::Space => self.space,
            EscapeFormatTrigger::Tab => self.tab,
        }
        .unwrap_or(false)
    }
}
/// Ordered per-format config; `None` disables a format explicitly.
#[derive(Clone, Debug, PartialEq)]
pub struct EscapeFormatTriggerConfig(pub Vec<(TextFormatType, Option<TriggerConfig>)>);
impl Default for EscapeFormatTriggerConfig {
    fn default() -> Self {
        let triggers = Some(TriggerConfig {
            enter: Some(true),
            space: Some(true),
            tab: Some(true),
            ..TriggerConfig::default()
        });
        Self(vec![
            (TextFormatType::Capitalize, triggers),
            (TextFormatType::Lowercase, triggers),
            (TextFormatType::Uppercase, triggers),
        ])
    }
}
/// Configuration for the model half of rich text.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RichTextConfig {
    /// Formats escaped by each interaction.
    pub escape_format_triggers: EscapeFormatTriggerConfig,
}
impl RichTextConfig {
    /// Shallow-merge each format's provided trigger fields, retaining format order.
    pub fn merge(&self, overrides: &Self) -> Self {
        let mut entries = self.escape_format_triggers.0.clone();
        for (format, value) in &overrides.escape_format_triggers.0 {
            if let Some((_, old)) = entries.iter_mut().find(|(f, _)| f == format) {
                *old = match (*old, *value) {
                    (Some(old), Some(new)) => Some(old.merge(new)),
                    (_, value) => value,
                };
            } else {
                entries.push((*format, *value));
            }
        }
        Self {
            escape_format_triggers: EscapeFormatTriggerConfig(entries),
        }
    }
}
/// Which exposed text boundary can escape a format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EscapeDirection {
    /// Start only.
    Start,
    /// End only.
    End,
    /// Either boundary.
    Both,
}
/// Reset configured typing formats in the supplied selection slot.
pub fn escape_formats_for_trigger(
    tx: &mut Transaction<'_>,
    slot: SelectionSlot,
    trigger: EscapeFormatTrigger,
    direction: EscapeDirection,
    config: &EscapeFormatTriggerConfig,
) -> crate::Result<()> {
    let selection = tx.range_at(slot)?.clone();
    let anchor = selection.anchor;
    let boundary = if selection.is_collapsed() && matches!(anchor, Point::Text { .. }) {
        let at_end = anchor.offset() == tx.text_content_size(anchor.key()).get()
            && tx.next_sibling(anchor.key()).is_none();
        let at_start = anchor.offset() == 0 && tx.prev_sibling(anchor.key()).is_none();
        match direction {
            EscapeDirection::Start => at_start,
            EscapeDirection::End => at_end,
            EscapeDirection::Both => at_start || at_end,
        }
    } else {
        false
    };
    let mut did_escape_boundary = false;
    for (format, triggers) in &config.0 {
        let Some(triggers) = triggers.filter(|t| t.enabled(trigger)) else {
            continue;
        };
        if triggers.only_at_boundary.unwrap_or(false) {
            if !boundary || !tx.text_data(anchor.key())?.format.has(*format) {
                continue;
            }
            did_escape_boundary = true;
        }
        if tx.range_at(slot)?.has_format(*format) {
            tx.toggle_selection_format_at(slot, *format)?;
        }
    }
    if did_escape_boundary {
        tx.set_selection_style_at(slot, "")?;
    }
    Ok(())
}
