use chrono::DateTime;

use std::collections::HashMap;

use crate::{
    calc_result::Range,
    constants::{DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH},
    expressions::{
        lexer::LexerMode,
        parser::{
            static_analysis::run_static_analysis_on_node,
            stringify::{
                rename_sheet_in_node, to_english_string, to_localized_string, to_rc_format,
            },
            Node, Parser,
        },
        types::CellReferenceRC,
    },
    language::{get_default_language, get_language},
    locale::{get_default_locale, get_locale},
    model::{get_milliseconds_since_epoch, Model, ParsedDefinedName},
    types::{
        DefinedName, Metadata, SheetState, Workbook, WorkbookSettings, WorkbookView, Worksheet,
        WorksheetView,
    },
    utils::ParsedReference,
};

use crate::tz::Tz;

pub const APPLICATION: &str = "IronCalc Sheets";
pub const APP_VERSION: &str = "10.0000";
pub const IRONCALC_USER: &str = "IronCalc User";

/// Name cannot be blank, must be shorter than 31 characters.
/// You can use all alphanumeric characters but not the following special characters:
/// \ , / , * , ? , : , [ , ].
fn is_valid_sheet_name(name: &str) -> bool {
    let invalid = ['\\', '/', '*', '?', ':', '[', ']'];
    !name.is_empty() && name.chars().count() <= 31 && !name.contains(&invalid[..])
}

impl<'a> Model<'a> {
    /// Creates a new worksheet. Note that it does not check if the name or the sheet_id exists
    fn new_empty_worksheet(name: &str, sheet_id: u32, view_ids: &[&u32]) -> Worksheet {
        let mut views = HashMap::new();
        for id in view_ids {
            views.insert(
                **id,
                WorksheetView {
                    row: 1,
                    column: 1,
                    range: [1, 1, 1, 1],
                    focus_row: 1,
                    focus_column: 1,
                    top_row: 1,
                    left_column: 1,
                },
            );
        }
        Worksheet {
            cols: vec![],
            rows: vec![],
            comments: vec![],
            dimension: "A1".to_string(),
            merged_cells: vec![],
            name: name.to_string(),
            shared_formulas: vec![],
            sheet_data: Default::default(),
            sheet_id,
            state: SheetState::Visible,
            color: Default::default(),
            frozen_columns: 0,
            frozen_rows: 0,
            show_grid_lines: true,
            views,
            conditional_formatting: vec![],
            links: HashMap::new(),
        }
    }

    pub fn get_new_sheet_id(&self) -> u32 {
        let mut index = 1;
        let worksheets = &self.workbook.worksheets;
        for worksheet in worksheets {
            index = index.max(worksheet.sheet_id);
        }
        index + 1
    }

    // This function parses all the internal formulas in all the worksheets
    // (in the default language ("en") and locale ("en") and the RC format)
    pub(crate) fn parse_formulas(&mut self) {
        let locale = self.locale;
        let language = self.language;

        self.parser.set_locale(get_default_locale());
        self.parser.set_language(get_default_language());
        self.parser.set_lexer_mode(LexerMode::R1C1);
        // The lookup of the shared formulas follows the parsed formulas: both
        // are made from the lists of the sheets, here.
        self.shared_formula_lookup.clear();
        let worksheets = &self.workbook.worksheets;
        for worksheet in worksheets {
            let shared_formulas = &worksheet.shared_formulas;
            self.shared_formula_lookup
                .push(crate::model::build_shared_formula_lookup(shared_formulas));
            let cell_reference = CellReferenceRC {
                sheet: worksheet.get_name(),
                row: 1,
                column: 1,
            };
            let mut parse_formula = Vec::new();
            for formula in shared_formulas {
                let t = self.parser.parse(formula, &cell_reference);
                let static_result = run_static_analysis_on_node(&t);
                parse_formula.push((std::sync::Arc::new(t), static_result));
            }
            self.parsed_formulas.push(parse_formula);
        }
        self.parser.set_lexer_mode(LexerMode::A1);
        self.parser.set_locale(locale);
        self.parser.set_language(language);
    }

    pub(crate) fn parse_defined_names(&mut self) {
        // Collect first to avoid borrow conflicts when calling self.parser below.
        let entries: Vec<(String, String, Option<u32>)> = self
            .workbook
            .defined_names
            .iter()
            .map(|dn| (dn.name.clone(), dn.formula.clone(), dn.sheet_id))
            .collect();

        let mut parsed_defined_names = HashMap::new();

        for (name, formula, sheet_id) in entries {
            let parsed_defined_name_formula = if let Ok(reference) =
                ParsedReference::parse_reference_formula(None, &formula, self.locale, |n| {
                    self.get_sheet_index_by_name(n)
                }) {
                match reference {
                    ParsedReference::CellReference(cell_reference) => {
                        ParsedDefinedName::CellReference(cell_reference)
                    }
                    ParsedReference::Range(left, right) => {
                        ParsedDefinedName::RangeReference(Range { left, right })
                    }
                }
            } else {
                // Try the full parser — the formula might be a LAMBDA definition.
                // Defined-name formulas may carry a leading '='; strip it before parsing.
                let formula_body = formula.strip_prefix('=').unwrap_or(&formula);
                let dummy_ref = CellReferenceRC {
                    sheet: self
                        .workbook
                        .worksheets
                        .first()
                        .map(|ws| ws.get_name())
                        .unwrap_or_else(|| "Sheet1".to_string()),
                    row: 1,
                    column: 1,
                };
                // Defined-name formulas are stored internally in English, so
                // they must be parsed with the English parser regardless of the
                // user's active language.
                match self.parse_internal_formula(formula_body, &dummy_ref) {
                    Node::LambdaDefKind { parameters, body } => {
                        ParsedDefinedName::LambdaDefinition(parameters, *body)
                    }
                    _ => ParsedDefinedName::InvalidDefinedNameFormula,
                }
            };

            let local_sheet_index = if let Some(sid) = sheet_id {
                if let Some(idx) = self.get_sheet_index_by_sheet_id(sid) {
                    Some(idx)
                } else {
                    // Sheet with given sheet_id not found.
                    continue;
                }
            } else {
                None
            };

            parsed_defined_names.insert(
                (local_sheet_index, name.to_lowercase()),
                parsed_defined_name_formula,
            );
        }

        self.parsed_defined_names = parsed_defined_names;
    }

    /// Reparses all formulas and defined names
    pub(crate) fn reset_parsed_structures(&mut self) {
        let defined_names = self.workbook.get_defined_names_with_scope();
        self.parser
            .set_worksheets_and_names(self.workbook.get_worksheet_names(), defined_names);
        self.parsed_formulas = vec![];
        self.parse_formulas();
        self.parsed_defined_names = HashMap::new();
        self.parse_defined_names();
        self.evaluate();
    }

    /// Gets the base name for new sheets
    fn get_sheet_name(&self) -> String {
        let language = self.language;
        match language.code.as_str() {
            "en" => "Sheet".to_string(),
            "es" => "Hoja".to_string(),
            "fr" => "Feuil".to_string(),
            "de" => "Tabelle".to_string(),
            "it" => "Foglio".to_string(),
            _ => "Sheet".to_string(),
        }
    }

    /// Adds a sheet with a automatically generated name
    pub fn new_sheet(&mut self) -> (String, u32) {
        // First we find a name
        let base_name = self.get_sheet_name();
        let base_name_uppercase = base_name.to_uppercase();
        let mut index = 1;
        while self
            .workbook
            .get_worksheet_names()
            .iter()
            .map(|s| s.to_uppercase())
            .any(|x| x == format!("{base_name_uppercase}{index}"))
        {
            index += 1;
        }
        let sheet_name = format!("{base_name}{index}");
        // Now we need a sheet_id
        let sheet_id = self.get_new_sheet_id();
        let view_ids: Vec<&u32> = self.workbook.views.keys().collect();
        let worksheet = Model::new_empty_worksheet(&sheet_name, sheet_id, &view_ids);
        self.workbook.worksheets.push(worksheet);
        self.reset_parsed_structures();
        (sheet_name, self.workbook.worksheets.len() as u32 - 1)
    }

    /// Inserts a sheet with a particular index
    /// Fails if a worksheet with that name already exists or the name is invalid
    /// Fails if the index is too large
    pub fn insert_sheet(
        &mut self,
        sheet_name: &str,
        sheet_index: u32,
        sheet_id: Option<u32>,
    ) -> Result<(), String> {
        if !is_valid_sheet_name(sheet_name) {
            return Err(format!("Invalid name for a sheet: '{sheet_name}'"));
        }
        if self
            .workbook
            .get_worksheet_names()
            .iter()
            .map(|s| s.to_uppercase())
            .any(|x| x == sheet_name.to_uppercase())
        {
            return Err("A worksheet already exists with that name".to_string());
        }
        let sheet_id = match sheet_id {
            Some(id) => id,
            None => self.get_new_sheet_id(),
        };
        let view_ids: Vec<&u32> = self.workbook.views.keys().collect();
        let worksheet = Model::new_empty_worksheet(sheet_name, sheet_id, &view_ids);
        if sheet_index as usize > self.workbook.worksheets.len() {
            return Err("Sheet index out of range".to_string());
        }
        self.workbook
            .worksheets
            .insert(sheet_index as usize, worksheet);
        self.reset_parsed_structures();
        Ok(())
    }

    /// Adds a sheet with a specific name
    /// Fails if a worksheet with that name already exists or the name is invalid
    pub fn add_sheet(&mut self, sheet_name: &str) -> Result<(), String> {
        self.insert_sheet(sheet_name, self.workbook.worksheets.len() as u32, None)
    }

    /// Duplicates an existing sheet, placing the copy immediately after the
    /// original. Returns the new sheet's name and index.
    ///
    /// The new sheet is named `"{original} ({n})"`, where `n` is the smallest
    /// positive integer that makes the name unique (so `Sheet1` becomes
    /// `Sheet1 (1)`, then `Sheet1 (2)`, ...).
    ///
    /// All the cell data, styles, conditional formatting rules, the sheet tab
    /// color and the view state are copied. Formulas are copied too:
    ///   * references to the source sheet itself (whether implicit, like `A1`,
    ///     or explicit, like `Sheet1!A1`) are retargeted to the new sheet, and
    ///   * references to other sheets are left untouched.
    ///
    /// When copying a sheet:
    ///   * names local to the source sheet are duplicated as names local to the
    ///     new sheet, and
    ///   * global names that reference the source sheet get a new sheet-local
    ///     copy on the new sheet (the original global name is kept unchanged).
    ///
    /// In both cases references to the source sheet are retargeted to the copy.
    ///
    /// Fails if `source_index` is out of range.
    pub fn duplicate_sheet(&mut self, source_index: u32) -> Result<(String, u32), String> {
        // Validate the source and capture what we need before mutating anything.
        let source = self.workbook.worksheet(source_index)?;
        let source_name = source.get_name();
        let source_sheet_id = source.sheet_id;

        // Find a unique name of the form "{source_name} ({index})". Sheet names
        // are capped at 31 characters (see `is_valid_sheet_name`), so when the
        // base name plus the suffix would overflow we truncate the base to make
        // room — and we still validate every candidate before accepting it,
        // since we insert the worksheet directly without going through
        // `insert_sheet`.
        let existing_names: Vec<String> = self
            .workbook
            .get_worksheet_names()
            .iter()
            .map(|s| s.to_uppercase())
            .collect();
        const MAX_SHEET_NAME_LEN: usize = 31;
        let mut index = 1;
        let new_name = loop {
            let suffix = format!(" ({index})");
            let suffix_len = suffix.chars().count();
            // Truncate the base name (by characters, to avoid splitting a
            // multi-byte char) so that base + suffix fits within the limit.
            let base: String = if source_name.chars().count() + suffix_len > MAX_SHEET_NAME_LEN {
                source_name
                    .chars()
                    .take(MAX_SHEET_NAME_LEN.saturating_sub(suffix_len))
                    .collect()
            } else {
                source_name.clone()
            };
            let candidate = format!("{base}{suffix}");
            if is_valid_sheet_name(&candidate)
                && !existing_names.contains(&candidate.to_uppercase())
            {
                break candidate;
            }
            index += 1;
        };

        let new_sheet_id = self.get_new_sheet_id();

        // Clone the worksheet wholesale: this brings over cells, styles, merge
        // cells, comments, conditional formatting, the tab color, frozen panes,
        // the views and the shared formulas.
        let mut new_worksheet = self.workbook.worksheet(source_index)?.clone();
        new_worksheet.name = new_name.clone();
        new_worksheet.sheet_id = new_sheet_id;

        // Retarget the copied formulas: references to the source sheet become
        // references to the new sheet, everything else is left as-is. Implicit
        // (same-sheet) references carry no sheet name, so they automatically
        // point to whichever sheet hosts the formula — the new sheet.
        //
        // Internal formulas are R1C1 and not anchored to a cell; we parse them
        // in the context of the *source* sheet (the parser already knows that
        // name) so that implicit references resolve to the source sheet index.
        self.parser.set_lexer_mode(LexerMode::R1C1);
        let cell_reference = CellReferenceRC {
            sheet: source_name.clone(),
            row: 1,
            column: 1,
        };
        let mut shared_formulas = Vec::with_capacity(new_worksheet.shared_formulas.len());
        for formula in &new_worksheet.shared_formulas {
            let mut t = self.parser.parse(formula, &cell_reference);
            rename_sheet_in_node(&mut t, source_index, &new_name);
            shared_formulas.push(to_rc_format(&t));
        }
        new_worksheet.shared_formulas = shared_formulas;
        self.parser.set_lexer_mode(LexerMode::A1);

        // Insert the copy right after the source sheet.
        let new_index = source_index as usize + 1;
        self.workbook.worksheets.insert(new_index, new_worksheet);

        // Duplicate the relevant defined names as sheet-local names on the copy.
        // We snapshot first to avoid borrowing the workbook while parsing.
        let context = self.defined_name_context();
        let defined_names = self.workbook.defined_names.clone();
        // A name can exist both as a sheet-local (to the source) and a global
        // definition. Name resolution prefers the sheet-local one (see
        // `Parser::get_defined_name`), so the copy must inherit that same
        // definition. Process local-to-source names first; combined with the
        // de-dup below this makes the sheet-local definition win regardless of
        // their order in `workbook.defined_names`. (`sort_by_key` is stable, so
        // entries within each group keep their original order.)
        let mut ordered: Vec<&DefinedName> = defined_names.iter().collect();
        ordered.sort_by_key(|dn| dn.sheet_id != Some(source_sheet_id));
        let mut new_defined_names: Vec<DefinedName> = Vec::new();
        for defined_name in ordered {
            let is_local_to_source = defined_name.sheet_id == Some(source_sheet_id);
            let is_global = defined_name.sheet_id.is_none();
            if !is_local_to_source && !is_global {
                // Local to a different sheet: leave it alone.
                continue;
            }
            // A name may be both global and local-to-source; since
            // local-to-source entries are processed first, the first match wins
            // and we skip any later (global) duplicate.
            if new_defined_names
                .iter()
                .any(|d| d.name.eq_ignore_ascii_case(&defined_name.name))
            {
                continue;
            }

            // Defined-name formulas are stored internally in English. Parse,
            // then retarget references to the source sheet to the copy.
            let had_equals = defined_name.formula.trim_start().starts_with('=');
            let body = defined_name
                .formula
                .strip_prefix('=')
                .unwrap_or(&defined_name.formula);
            let mut node = self.parse_internal_formula(body, &context);
            let before = to_english_string(&node, &context);
            rename_sheet_in_node(&mut node, source_index, &new_name);
            let after = to_english_string(&node, &context);

            // Global names are only duplicated when they actually reference the
            // source sheet (matching Excel). Local names are always duplicated.
            if is_global && before == after {
                continue;
            }

            let formula = if had_equals {
                format!("={after}")
            } else {
                after
            };
            new_defined_names.push(DefinedName {
                name: defined_name.name.clone(),
                formula,
                sheet_id: Some(new_sheet_id),
            });
        }
        self.workbook.defined_names.extend(new_defined_names);

        self.reset_parsed_structures();
        Ok((new_name, new_index as u32))
    }

    /// Renames a sheet and updates all existing references to that sheet.
    /// It can fail if:
    ///   * The original sheet does not exists
    ///   * The target sheet already exists
    ///   * The target sheet name is invalid
    pub fn rename_sheet(&mut self, old_name: &str, new_name: &str) -> Result<(), String> {
        if let Some(sheet_index) = self.get_sheet_index_by_name(old_name) {
            return self.rename_sheet_by_index(sheet_index, new_name);
        }
        Err(format!("Could not find sheet {old_name}"))
    }

    /// Renames a sheet and updates all existing references to that sheet.
    /// It can fail if:
    ///   * The original index is out of bounds
    ///   * The target sheet name already exists
    ///   * The target sheet name is invalid
    pub fn rename_sheet_by_index(
        &mut self,
        sheet_index: u32,
        new_name: &str,
    ) -> Result<(), String> {
        if !is_valid_sheet_name(new_name) {
            return Err(format!("Invalid name for a sheet: '{new_name}'."));
        }
        if let Some(new_index) = self.get_sheet_index_by_name(new_name) {
            if new_index != sheet_index {
                return Err(format!("Sheet already exists: '{new_name}'."));
            }
        }
        // Gets the new name and checks that a sheet with that index exists
        let old_name = self.workbook.worksheet(sheet_index)?.get_name();

        // Parse all formulas with the old name
        // All internal formulas are R1C1
        self.parser.set_lexer_mode(LexerMode::R1C1);

        for worksheet in &mut self.workbook.worksheets {
            // R1C1 formulas are not tied to a cell (but are tied to a cell)
            let cell_reference = &CellReferenceRC {
                sheet: worksheet.get_name(),
                row: 1,
                column: 1,
            };
            let mut formulas = Vec::new();
            for formula in &worksheet.shared_formulas {
                let mut t = self.parser.parse(formula, cell_reference);
                rename_sheet_in_node(&mut t, sheet_index, new_name);
                formulas.push(to_rc_format(&t));
            }
            worksheet.shared_formulas = formulas;
        }

        // Set the mode back to A1
        self.parser.set_lexer_mode(LexerMode::A1);

        // We reparse all the defined names formulas
        let mut defined_names = Vec::new();
        // Defined names do not have a context, we can use anything
        let cell_reference = &CellReferenceRC {
            sheet: old_name.clone(),
            row: 1,
            column: 1,
        };
        for defined_name in &mut self.workbook.defined_names {
            let mut t = self.parser.parse(&defined_name.formula, cell_reference);
            rename_sheet_in_node(&mut t, sheet_index, new_name);
            let formula = to_localized_string(&t, cell_reference, self.locale, self.language);
            defined_names.push(DefinedName {
                name: defined_name.name.clone(),
                formula,
                sheet_id: defined_name.sheet_id,
            });
        }
        self.workbook.defined_names = defined_names;

        // Update the name of the worksheet
        self.workbook.worksheet_mut(sheet_index)?.set_name(new_name);
        self.reset_parsed_structures();
        Ok(())
    }

    /// Deletes a sheet by index. Fails if:
    ///   * The sheet does not exists
    ///   * It is the last sheet
    pub fn delete_sheet(&mut self, sheet_index: u32) -> Result<(), String> {
        let worksheets = &self.workbook.worksheets;
        let sheet_count = worksheets.len() as u32;
        if sheet_count == 1 {
            return Err("Cannot delete only sheet".to_string());
        };
        if sheet_index >= sheet_count {
            return Err("Sheet index too large".to_string());
        };
        self.workbook.worksheets.remove(sheet_index as usize);
        self.reset_parsed_structures();
        Ok(())
    }

    /// Moves the worksheet at `sheet_index` to `new_index`, shifting the other
    /// sheets to accommodate. The moved worksheet ends up at exactly `new_index`.
    ///
    /// Sheet order is only a position in the worksheet vector; formulas key off
    /// the sheet name (and defined names off the sheet id), so cross-sheet
    /// references stay valid across a move — `reset_parsed_structures` re-resolves
    /// every reference by name against the reordered vector.
    ///
    /// Fails if either index is out of range. Moving a sheet to its current
    /// position is a no-op.
    pub fn move_sheet(&mut self, sheet_index: u32, new_index: u32) -> Result<(), String> {
        let sheet_count = self.workbook.worksheets.len() as u32;
        if sheet_index >= sheet_count {
            return Err("Sheet index too large".to_string());
        }
        if new_index >= sheet_count {
            return Err("Target sheet index too large".to_string());
        }
        if sheet_index == new_index {
            return Ok(());
        }
        let worksheet = self.workbook.worksheets.remove(sheet_index as usize);
        self.workbook
            .worksheets
            .insert(new_index as usize, worksheet);
        self.reset_parsed_structures();
        Ok(())
    }

    /// Deletes a sheet by name. Fails if:
    ///   * The sheet does not exists
    ///   * It is the last sheet
    pub fn delete_sheet_by_name(&mut self, name: &str) -> Result<(), String> {
        if let Some(sheet_index) = self.get_sheet_index_by_name(name) {
            self.delete_sheet(sheet_index)
        } else {
            Err("Sheet not found".to_string())
        }
    }

    /// Deletes a sheet by sheet_id. Fails if:
    ///   * The sheet by sheet_id does not exists
    ///   * It is the last sheet
    pub fn delete_sheet_by_sheet_id(&mut self, sheet_id: u32) -> Result<(), String> {
        if let Some(sheet_index) = self.get_sheet_index_by_sheet_id(sheet_id) {
            self.delete_sheet(sheet_index)
        } else {
            Err("Sheet not found".to_string())
        }
    }

    pub(crate) fn get_sheet_index_by_sheet_id(&self, sheet_id: u32) -> Option<u32> {
        let worksheets = &self.workbook.worksheets;
        for (index, worksheet) in worksheets.iter().enumerate() {
            if worksheet.sheet_id == sheet_id {
                return Some(index as u32);
            }
        }
        None
    }

    /// Creates a new workbook with one empty sheet
    pub fn new_empty(
        name: &'a str,
        locale_id: &'a str,
        timezone: &'a str,
        language_id: &'a str,
    ) -> Result<Model<'a>, String> {
        let tz = Tz::parse(timezone)?;
        let locale = match get_locale(locale_id) {
            Ok(l) => l,
            Err(_) => return Err(format!("Invalid locale: {locale_id}")),
        };
        let language = match get_language(language_id) {
            Ok(l) => l,
            Err(_) => return Err(format!("Invalid language: {language_id}")),
        };

        let milliseconds = get_milliseconds_since_epoch();
        let seconds = milliseconds / 1000;
        let dt = match DateTime::from_timestamp(seconds, 0) {
            Some(s) => s,
            None => return Err(format!("Invalid timestamp: {milliseconds}")),
        };
        // "2020-08-06T21:20:53Z
        let now = dt.format("%Y-%m-%dT%H:%M:%SZ").to_string();

        let mut views = HashMap::new();
        views.insert(
            0,
            WorkbookView {
                sheet: 0,
                window_width: DEFAULT_WINDOW_WIDTH,
                window_height: DEFAULT_WINDOW_HEIGHT,
            },
        );

        let sheet_name = match language.code.as_str() {
            "en" => "Sheet1".to_string(),
            "es" => "Hoja1".to_string(),
            "fr" => "Feuil1".to_string(),
            "de" => "Tabelle1".to_string(),
            "it" => "Foglio1".to_string(),
            _ => "Sheet1".to_string(),
        };

        // String versions of the locale are added here to simplify the serialize/deserialize logic
        let workbook = Workbook {
            shared_strings: vec![],
            defined_names: vec![],
            worksheets: vec![Model::new_empty_worksheet(&sheet_name, 1, &[&0])],
            styles: Default::default(),
            name: name.to_string(),
            settings: WorkbookSettings {
                tz: timezone.to_string(),
                locale: locale_id.to_string(),
            },
            metadata: Metadata {
                application: APPLICATION.to_string(),
                app_version: APP_VERSION.to_string(),
                creator: IRONCALC_USER.to_string(),
                last_modified_by: IRONCALC_USER.to_string(),
                created: now.clone(),
                last_modified: now,
            },
            tables: HashMap::new(),
            views,
            theme: Default::default(),
        };
        let parsed_formulas = Vec::new();
        let worksheets = &workbook.worksheets;
        let worksheet_names = worksheets.iter().map(|s| s.get_name()).collect();
        let parser = Parser::new(worksheet_names, vec![], HashMap::new(), locale, language);

        let mut model = Model {
            workbook,
            shared_strings: HashMap::new(),
            parsed_formulas,
            shared_formula_lookup: Vec::new(),
            parsed_defined_names: HashMap::new(),
            parser,
            locale,
            language,
            tz,
            view_id: 0,
            variable_stack: HashMap::new(),
            last_variable_id: 0,
            lambdas: HashMap::new(),
            last_lambda_id: 0,
            evaluation: crate::evaluation::Evaluation::default(),
            cf_cache: HashMap::new(),
            links: HashMap::new(),
        };
        model.parse_formulas();
        model.evaluate_conditional_formatting();
        Ok(model)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    use crate::cf_types::{CfRuleInput, ValueOperator};
    use crate::test::util::new_empty_model;
    use crate::types::{Color, Dxf, Fill};

    fn red_fill() -> Dxf {
        Dxf {
            font: None,
            fill: Some(Fill {
                color: Color::Rgb("#FF0000".to_string()),
            }),
            border: None,
            num_fmt: None,
            alignment: None,
        }
    }

    #[test]
    fn test_duplicate_sheet_naming() {
        let mut model = new_empty_model();

        // Sheet1 -> Sheet1 (1)
        let (name1, index1) = model.duplicate_sheet(0).unwrap();
        assert_eq!(name1, "Sheet1 (1)");
        assert_eq!(index1, 1); // inserted right after the source

        // Duplicating Sheet1 again -> Sheet1 (2)
        let (name2, _) = model.duplicate_sheet(0).unwrap();
        assert_eq!(name2, "Sheet1 (2)");

        // Duplicating the copy -> Sheet1 (1) (1)
        let source = model.get_sheet_index_by_name("Sheet1 (1)").unwrap();
        let (name3, _) = model.duplicate_sheet(source).unwrap();
        assert_eq!(name3, "Sheet1 (1) (1)");

        // Out of range
        assert!(model.duplicate_sheet(100).is_err());
    }

    #[test]
    fn test_duplicate_sheet_name_respects_length_limit() {
        let mut model = new_empty_model();
        // A 31-character name (the maximum allowed).
        let long_name = "AAAAAAAAAABBBBBBBBBBCCCCCCCCCCD";
        assert_eq!(long_name.chars().count(), 31);
        model.rename_sheet_by_index(0, long_name).unwrap();

        // Naively "{name} (1)" would be 35 chars and thus invalid. The base
        // name must be truncated so the result stays within the limit.
        let (new_name, new_index) = model.duplicate_sheet(0).unwrap();
        assert!(is_valid_sheet_name(&new_name));
        assert!(new_name.chars().count() <= 31);
        assert!(new_name.ends_with(" (1)"));
        assert_eq!(
            model.workbook.worksheet(new_index).unwrap().get_name(),
            new_name
        );

        // A second copy still produces a distinct, valid name.
        let (new_name2, _) = model.duplicate_sheet(0).unwrap();
        assert!(is_valid_sheet_name(&new_name2));
        assert!(new_name2.chars().count() <= 31);
        assert_ne!(new_name2, new_name);
    }

    #[test]
    fn test_duplicate_sheet_formulas() {
        let mut model = new_empty_model();
        model.set_user_input(0, 1, 1, "10".to_string()).unwrap();
        model.set_user_input(0, 1, 2, "=A1*2".to_string()).unwrap();
        model.evaluate();

        let (_, new_index) = model.duplicate_sheet(0).unwrap();

        // The implicit self-reference is preserved and points to the copy.
        assert_eq!(
            model.get_cell_formula(new_index, 1, 2).unwrap(),
            Some("=A1*2".to_string())
        );
        assert_eq!(
            model.get_formatted_cell_value(new_index, 1, 2).unwrap(),
            "20"
        );

        // The copy is independent: changing the copy doesn't touch the original.
        model
            .set_user_input(new_index, 1, 1, "100".to_string())
            .unwrap();
        model.evaluate();
        assert_eq!(
            model.get_formatted_cell_value(new_index, 1, 2).unwrap(),
            "200"
        );
        assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "20");
    }

    #[test]
    fn test_duplicate_sheet_formulas_to_other_sheets() {
        let mut model = new_empty_model();
        model.add_sheet("Other").unwrap();
        let other = model.get_sheet_index_by_name("Other").unwrap();
        model.set_user_input(other, 1, 1, "7".to_string()).unwrap();

        // A reference to another sheet, and an explicit self-reference.
        model
            .set_user_input(0, 1, 1, "=Other!A1".to_string())
            .unwrap();
        model.set_user_input(0, 2, 1, "42".to_string()).unwrap();
        model
            .set_user_input(0, 1, 2, "=Sheet1!A2".to_string())
            .unwrap();
        model.evaluate();

        let (_, new_index) = model.duplicate_sheet(0).unwrap();

        // The cross-sheet reference is unchanged.
        assert_eq!(
            model.get_cell_formula(new_index, 1, 1).unwrap(),
            Some("=Other!A1".to_string())
        );
        assert_eq!(
            model.get_formatted_cell_value(new_index, 1, 1).unwrap(),
            "7"
        );

        // The explicit self-reference is retargeted to the copy.
        assert_eq!(
            model.get_cell_formula(new_index, 1, 2).unwrap(),
            Some("='Sheet1 (1)'!A2".to_string())
        );
        assert_eq!(
            model.get_formatted_cell_value(new_index, 1, 2).unwrap(),
            "42"
        );
    }

    #[test]
    fn test_duplicate_sheet_local_defined_names() {
        let mut model = new_empty_model();
        model.set_user_input(0, 1, 1, "5".to_string()).unwrap();
        model
            .new_defined_name("local_name", Some(0), "Sheet1!$A$1")
            .unwrap();
        model.evaluate();

        let (_, new_index) = model.duplicate_sheet(0).unwrap();

        // The local name is duplicated, scoped to the copy, retargeted to it.
        let names = model.get_defined_name_list();
        let copy = names
            .iter()
            .find(|(name, scope, _)| name == "local_name" && *scope == Some(new_index))
            .expect("local name should be duplicated on the copy");
        assert_eq!(copy.2, "'Sheet1 (1)'!$A$1");

        // The original local name is left untouched.
        assert!(names
            .iter()
            .any(|(name, scope, formula)| name == "local_name"
                && *scope == Some(0)
                && formula == "Sheet1!$A$1"));
    }

    #[test]
    fn test_duplicate_sheet_global_names_made_local() {
        let mut model = new_empty_model();
        model.add_sheet("Other").unwrap();
        model.set_user_input(0, 1, 1, "5".to_string()).unwrap();
        // A global name referencing the source sheet, and one that doesn't.
        model
            .new_defined_name("from_source", None, "Sheet1!$A$1")
            .unwrap();
        model
            .new_defined_name("from_other", None, "Other!$A$1")
            .unwrap();
        model.evaluate();

        let (_, new_index) = model.duplicate_sheet(0).unwrap();
        let names = model.get_defined_name_list();

        // The original global names are preserved.
        assert!(names
            .iter()
            .any(|(name, scope, _)| name == "from_source" && scope.is_none()));
        assert!(names
            .iter()
            .any(|(name, scope, _)| name == "from_other" && scope.is_none()));

        // The global name referencing the source is duplicated as a sheet-local
        // name on the copy, retargeted to it.
        let copy = names
            .iter()
            .find(|(name, scope, _)| name == "from_source" && *scope == Some(new_index))
            .expect("global name referencing source should become local on copy");
        assert_eq!(copy.2, "'Sheet1 (1)'!$A$1");

        // The global name that does not reference the source is NOT duplicated.
        assert!(!names
            .iter()
            .any(|(name, scope, _)| name == "from_other" && *scope == Some(new_index)));
    }

    #[test]
    fn test_duplicate_sheet_prefers_local_over_global_name() {
        // When a name exists both globally and as sheet-local to the source,
        // resolution prefers the sheet-local one, so the copy must inherit the
        // sheet-local definition — regardless of which is stored first.
        let mut model = new_empty_model();
        // The global is created first (so it comes earlier in `defined_names`).
        model
            .new_defined_name("shared", None, "Sheet1!$A$1")
            .unwrap();
        model
            .new_defined_name("shared", Some(0), "Sheet1!$B$2")
            .unwrap();
        model.evaluate();

        let (_, new_index) = model.duplicate_sheet(0).unwrap();
        let names = model.get_defined_name_list();

        // Exactly one "shared" name is local to the copy and it comes from the
        // sheet-local definition ($B$2), not the global one ($A$1).
        let local_copies: Vec<_> = names
            .iter()
            .filter(|(name, scope, _)| name == "shared" && *scope == Some(new_index))
            .collect();
        assert_eq!(local_copies.len(), 1);
        assert_eq!(local_copies[0].2, "'Sheet1 (1)'!$B$2");
    }

    #[test]
    fn test_duplicate_sheet_conditional_formatting() {
        let mut model = new_empty_model();
        model.set_user_input(0, 1, 1, "10".to_string()).unwrap();
        model
            .add_conditional_formatting(
                0,
                "A1:A10",
                CfRuleInput::CellIs {
                    operator: ValueOperator::GreaterThan,
                    formula: "5".to_string(),
                    formula2: None,
                    format: red_fill(),
                    stop_if_true: false,
                },
            )
            .unwrap();
        model.evaluate();

        let (_, new_index) = model.duplicate_sheet(0).unwrap();

        let source_rules = model.get_conditional_formatting_list(0).unwrap();
        let copy_rules = model.get_conditional_formatting_list(new_index).unwrap();
        assert_eq!(copy_rules.len(), 1);
        assert_eq!(copy_rules[0].range, "A1:A10");
        assert_eq!(copy_rules[0].cf_rule, source_rules[0].cf_rule);
    }

    #[test]
    fn test_duplicate_sheet_color() {
        let mut model = new_empty_model();
        let color = Color::Rgb("#123456".to_string());
        model.set_sheet_color(0, &color).unwrap();

        let (_, new_index) = model.duplicate_sheet(0).unwrap();
        assert_eq!(model.workbook.worksheet(new_index).unwrap().color, color);
    }

    #[test]
    fn test_is_valid_sheet_name() {
        assert!(is_valid_sheet_name("Sheet1"));
        assert!(is_valid_sheet_name("Zażółć gęślą jaźń"));

        assert!(is_valid_sheet_name(" "));
        assert!(!is_valid_sheet_name(""));

        assert!(is_valid_sheet_name("🙈"));

        assert!(is_valid_sheet_name("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCD")); // 31
        assert!(!is_valid_sheet_name("AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDE")); // 32
    }
}
