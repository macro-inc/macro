#[cfg(not(target_arch = "wasm32"))]
use regex::Regex;
#[cfg(target_arch = "wasm32")]
use regex_lite::Regex;

use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    model::Model,
};

impl<'a> Model<'a> {
    /// REGEXEXTRACT(text, regular_expression, [return_all])
    ///
    /// Returns the first substring of `text` that matches `regular_expression`.
    /// If the pattern contains capture groups, returns the content of the first group.
    /// When the optional `return_all` argument is 1, returns a horizontal array of
    /// every match (one match per column) instead of only the first one.
    /// Returns #N/A if there is no match, #VALUE! if the regex is invalid.
    pub(crate) fn fn_regexextract(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let pattern = match self.get_string(&args[1], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let return_all = if args.len() == 3 {
            match self.get_number(&args[2], cell) {
                Ok(n) => n != 0.0,
                Err(e) => return e,
            }
        } else {
            false
        };
        let re = match Regex::new(&pattern) {
            Ok(r) => r,
            Err(_) => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Invalid regular expression".to_string(),
                )
            }
        };
        if return_all {
            let row: Vec<ArrayNode> = re
                .find_iter(&text)
                .map(|m| ArrayNode::String(m.as_str().to_string()))
                .collect();
            if row.is_empty() {
                return CalcResult::new_error(Error::NA, cell, "No match found".to_string());
            }
            CalcResult::Array(vec![row])
        } else {
            match re.captures(&text) {
                None => CalcResult::new_error(Error::NA, cell, "No match found".to_string()),
                Some(caps) => {
                    // If there is at least one explicit capture group, return group 1.
                    // Otherwise return the full match (group 0).
                    let matched = if caps.len() > 1 {
                        caps.get(1).map_or("", |m| m.as_str())
                    } else {
                        caps.get(0).map_or("", |m| m.as_str())
                    };
                    CalcResult::String(matched.to_string())
                }
            }
        }
    }

    /// REGEXREPLACE(text, regular_expression, replacement)
    ///
    /// Replaces every substring of `text` that matches `regular_expression` with
    /// `replacement`. Returns #VALUE! if the regex is invalid.
    pub(crate) fn fn_regexreplace(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let pattern = match self.get_string(&args[1], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let replacement = match self.get_string(&args[2], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let re = match Regex::new(&pattern) {
            Ok(r) => r,
            Err(_) => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Invalid regular expression".to_string(),
                )
            }
        };
        CalcResult::String(re.replace_all(&text, replacement.as_str()).into_owned())
    }

    /// REGEXTEST(text, regular_expression)
    ///
    /// Returns `TRUE` if `regular_expression` matches anywhere in `text`, `FALSE`
    /// otherwise. Returns #VALUE! if the regex is invalid.
    pub(crate) fn fn_regextest(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let pattern = match self.get_string(&args[1], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let re = match Regex::new(&pattern) {
            Ok(r) => r,
            Err(_) => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Invalid regular expression".to_string(),
                )
            }
        };
        CalcResult::Boolean(re.is_match(&text))
    }
}
