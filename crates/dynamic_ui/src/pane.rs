//! Panes: widgets a saved view addresses by their [`PaneId`].

use crate::{PaneId, View, Widget};

impl Widget {
    /// The widget's pane id, when it has one.
    pub fn pane_id(&self) -> Option<&PaneId> {
        match self {
            Widget::Md { id, .. }
            | Widget::Timeline { id, .. }
            | Widget::List { id, .. }
            | Widget::ChannelMessage { id, .. }
            | Widget::Events { id, .. }
            | Widget::Cards { id, .. }
            | Widget::Tags { id, .. }
            | Widget::AgentUpdates { id, .. }
            | Widget::Container { id, .. } => id.as_ref(),
        }
    }

    /// The widgets nested directly inside this one.
    fn children_mut(&mut self) -> &mut [Widget] {
        match self {
            Widget::Container { children, .. } => children,
            Widget::Md { .. }
            | Widget::Timeline { .. }
            | Widget::List { .. }
            | Widget::ChannelMessage { .. }
            | Widget::Events { .. }
            | Widget::Cards { .. }
            | Widget::Tags { .. }
            | Widget::AgentUpdates { .. } => &mut [],
        }
    }

    fn children(&self) -> &[Widget] {
        match self {
            Widget::Container { children, .. } => children,
            Widget::Md { .. }
            | Widget::Timeline { .. }
            | Widget::List { .. }
            | Widget::ChannelMessage { .. }
            | Widget::Events { .. }
            | Widget::Cards { .. }
            | Widget::Tags { .. }
            | Widget::AgentUpdates { .. } => &[],
        }
    }
}

impl View {
    /// Replace the pane with this id, at any depth, by `widget`. Returns
    /// false when no pane has the id.
    pub fn replace_pane(&mut self, pane: &PaneId, widget: Widget) -> bool {
        let Some(slot) = find_pane(&mut self.widgets, pane) else {
            return false;
        };
        *slot = widget;
        true
    }

    /// A pane id two widgets share, which would make a pane ambiguous.
    pub fn duplicate_pane_id(&self) -> Option<&PaneId> {
        let mut seen = std::collections::HashSet::new();
        let mut stack: Vec<&Widget> = self.widgets.iter().collect();

        while let Some(widget) = stack.pop() {
            if let Some(id) = widget.pane_id()
                && !seen.insert(id)
            {
                return Some(id);
            }
            stack.extend(widget.children());
        }

        None
    }
}

fn find_pane<'a>(widgets: &'a mut [Widget], pane: &PaneId) -> Option<&'a mut Widget> {
    for slot in widgets.iter_mut() {
        if slot.pane_id() == Some(pane) {
            return Some(slot);
        }

        if let Some(found) = find_pane(slot.children_mut(), pane) {
            return Some(found);
        }
    }

    None
}
