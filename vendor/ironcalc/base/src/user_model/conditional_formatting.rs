use crate::{
    cf_types::{CfRule, CfRuleInput, ConditionalFormattingView},
    types::Dxf,
};

use super::{common::UserModel, history::Diff};

impl<'a> UserModel<'a> {
    /// Returns all CF rules for the given sheet, sorted by priority descending.
    ///
    /// Each entry carries its storage `index`; see
    /// [`crate::Model::get_conditional_formatting_list`].
    pub fn get_conditional_formatting_list(
        &self,
        sheet: u32,
    ) -> Result<Vec<ConditionalFormattingView>, String> {
        self.model.get_conditional_formatting_list(sheet)
    }

    /// Returns the differential format (Dxf) for the CF rule at `index` on `sheet`,
    /// or `None` if the rule type has no associated dxf (e.g. ColorScale, DataBar).
    pub fn get_dxf_for_conditional_formatting(
        &self,
        sheet: u32,
        index: u32,
    ) -> Result<Option<Dxf>, String> {
        self.model
            .get_dxf_for_conditional_formatting(sheet, index as usize)
    }

    /// Adds a new CF rule to `sheet`.
    pub fn add_conditional_formatting(
        &mut self,
        sheet: u32,
        range: &str,
        rule: CfRuleInput,
    ) -> Result<(), String> {
        let priority = self.model.add_conditional_formatting(sheet, range, rule)?;
        // Read back the stored entry so the Diff contains the dxf_id that was assigned.
        let stored_rule = self
            .model
            .workbook
            .worksheet(sheet)
            .ok()
            .and_then(|ws| {
                ws.conditional_formatting
                    .iter()
                    .find(|cf| cf.priority == priority)
                    .map(|cf| cf.cf_rule.clone())
            })
            .unwrap_or(CfRule::DuplicateValues {
                dxf_id: 0,
                stop_if_true: false,
            });
        self.push_diff_list(vec![Diff::AddConditionalFormatting {
            sheet,
            range: range.to_string(),
            rule: Box::new(stored_rule),
            priority,
        }]);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Removes the CF rule at `index` from `sheet`.
    pub fn delete_conditional_formatting(&mut self, sheet: u32, index: u32) -> Result<(), String> {
        let old = self
            .model
            .delete_conditional_formatting(sheet, index as usize)?;
        self.push_diff_list(vec![Diff::DeleteConditionalFormatting {
            sheet,
            index,
            old_range: old.range,
            old_rule: Box::new(old.cf_rule),
            old_priority: old.priority,
        }]);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Replaces the range and rule of the CF entry at `index` on `sheet`.
    pub fn update_conditional_formatting(
        &mut self,
        sheet: u32,
        index: u32,
        new_range: &str,
        new_rule: CfRuleInput,
    ) -> Result<(), String> {
        let old =
            self.model
                .update_conditional_formatting(sheet, index as usize, new_range, new_rule)?;
        // Read back the stored entry so the Diff contains the dxf_id that was assigned.
        let stored_rule = self
            .model
            .workbook
            .worksheet(sheet)
            .ok()
            .and_then(|ws| {
                ws.conditional_formatting
                    .get(index as usize)
                    .map(|cf| cf.cf_rule.clone())
            })
            .unwrap_or(CfRule::DuplicateValues {
                dxf_id: 0,
                stop_if_true: false,
            });
        self.push_diff_list(vec![Diff::UpdateConditionalFormatting {
            sheet,
            index,
            old_range: old.range,
            old_rule: Box::new(old.cf_rule),
            old_priority: old.priority,
            new_range: new_range.to_string(),
            new_rule: Box::new(stored_rule),
        }]);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Raises the priority of the CF rule at `index` on `sheet` by swapping its
    /// priority with the next-higher-priority rule. No-op if it is already the
    /// highest-priority rule.
    pub fn raise_conditional_formatting_priority(
        &mut self,
        sheet: u32,
        index: u32,
    ) -> Result<(), String> {
        self.swap_conditional_formatting_priority(sheet, index, true)
    }

    /// Lowers the priority of the CF rule at `index` on `sheet` by swapping its
    /// priority with the next-lower-priority rule. No-op if it is already the
    /// lowest-priority rule.
    pub fn lower_conditional_formatting_priority(
        &mut self,
        sheet: u32,
        index: u32,
    ) -> Result<(), String> {
        self.swap_conditional_formatting_priority(sheet, index, false)
    }

    /// Shared implementation for raising/lowering CF priority. Snapshots the
    /// priorities before and after delegating to the base model, then records a
    /// `SwapConditionalFormattingPriority` diff for the (at most two) rules whose
    /// priority changed so the operation can be undone/redone.
    fn swap_conditional_formatting_priority(
        &mut self,
        sheet: u32,
        index: u32,
        raise: bool,
    ) -> Result<(), String> {
        let before: Vec<u32> = self
            .model
            .workbook
            .worksheet(sheet)?
            .conditional_formatting
            .iter()
            .map(|cf| cf.priority)
            .collect();
        if raise {
            self.model
                .raise_conditional_formatting_priority(sheet, index as usize)?;
        } else {
            self.model
                .lower_conditional_formatting_priority(sheet, index as usize)?;
        }
        let after: Vec<u32> = self
            .model
            .workbook
            .worksheet(sheet)?
            .conditional_formatting
            .iter()
            .map(|cf| cf.priority)
            .collect();
        // A successful swap touches exactly two rules; if nothing changed (the
        // rule was already at the boundary) there is nothing to record.
        let changed: Vec<usize> = (0..before.len())
            .filter(|&i| before[i] != after[i])
            .collect();
        if let [a, b] = changed[..] {
            self.push_diff_list(vec![Diff::SwapConditionalFormattingPriority {
                sheet,
                index_a: a as u32,
                index_b: b as u32,
                priority_a: before[a],
                priority_b: before[b],
            }]);
        }
        self.evaluate_if_not_paused();
        Ok(())
    }
}
