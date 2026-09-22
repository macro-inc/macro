//! Editors whose accepted changes have not yet been reported with a snapshot.
use super::document::DocumentAttribution;

/// Deduplicates editors between existing document notifications.
#[derive(Debug, Default)]
pub struct PendingEditors {
    editors: Vec<DocumentAttribution>,
}

impl PendingEditors {
    /// Retain each authenticated actor and represented user once per notification.
    pub fn record(&mut self, attribution: &DocumentAttribution) {
        if !self.editors.contains(attribution) {
            self.editors.push(attribution.clone());
        }
    }

    /// Transfer collected editors to the existing best-effort notification.
    pub fn take(&mut self) -> Vec<DocumentAttribution> {
        std::mem::take(&mut self.editors)
    }
}

#[cfg(test)]
mod test;
