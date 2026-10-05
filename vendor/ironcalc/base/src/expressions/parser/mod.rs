/*!
# GRAMMAR

<pre class="rust">
opComp   => '=' | '<' | '>' | '<=' } '>=' | '<>'
opFactor => '*' | '/'
unaryOp  => '-' | '+'

expr    => concat (opComp concat)*
concat  => term ('&' term)*
term    => factor (opFactor factor)*
factor  => prod (opProd prod)*
prod    => power ('^' power)*
power   => (unaryOp)* range '%'*
range   => implicit (':' primary)?
implicit=> '@' primary | primary '#' | primary
primary => '(' expr ')'
        => number
        => function '(' f_args ')'
        => LAMBDA '(' f_args ')' '(' f_args ')'
        => name
        => string
        => '{' a_args '}'
        => bool
        => bool()
        => error

f_args  => e (',' e)*
</pre>
*/

use std::collections::HashMap;

use crate::functions::Function;
use crate::language::get_default_language;
use crate::language::get_language;
use crate::language::Language;
use crate::locale::get_default_locale;
use crate::locale::get_locale;
use crate::locale::Locale;
use crate::types::Table;

use super::lexer;
use super::token;
use super::token::OpUnary;
use super::token::TableReference;
use super::token::TokenType;
use super::types::*;
use super::utils::number_to_column;

use token::OpCompare;

mod lambda;
pub mod move_formula;
pub mod static_analysis;
pub mod stringify;

#[cfg(test)]
mod tests;

pub(crate) fn parse_range(formula: &str) -> Result<(i32, i32, i32, i32), String> {
    let mut lexer = lexer::Lexer::new(
        formula,
        lexer::LexerMode::A1,
        #[allow(clippy::expect_used)]
        get_locale("en").expect(""),
        #[allow(clippy::expect_used)]
        get_language("en").expect(""),
    );
    if let TokenType::Range {
        left,
        right,
        sheet: _,
    } = lexer.next_token()
    {
        Ok((left.column, left.row, right.column, right.row))
    } else {
        Err("Not a range".to_string())
    }
}

fn get_table_column_by_name(table_column_name: &str, table: &Table) -> Option<i32> {
    for (index, table_column) in table.columns.iter().enumerate() {
        if table_column.name == table_column_name {
            return Some(index as i32);
        }
    }
    None
}

// DefinedNameS is a tuple with the name of the defined name, the index of the sheet and the formula
pub type DefinedNameS = (String, Option<u32>, String);

pub(crate) struct Reference<'a> {
    sheet_name: &'a Option<String>,
    sheet_index: u32,
    absolute_row: bool,
    absolute_column: bool,
    row: i32,
    column: i32,
}

#[derive(PartialEq, Clone, Debug)]
pub enum ArrayNode {
    Boolean(bool),
    Number(f64),
    String(String),
    Error(token::Error),
    /// An empty (blank) cell from a range reference.
    Empty,
}

#[derive(PartialEq, Clone, Debug)]
pub struct NamedVariable {
    pub(crate) name: String,
    pub(crate) id: Option<u32>,
    pub(crate) is_optional: bool,
}

#[derive(PartialEq, Clone, Debug, serde::Serialize)]
pub enum ExpectedTokens {
    // We know the next token could be a range
    Range,
    // We know the next token could be a function that starts with the given name
    FunctionName(String),
    // We know the next token could be an argument to a function (name, arg index)
    Argument(String, u32),
    Other,
}

/// What the grammar accepts at a cursor position, plus the span the UI should
/// replace when it inserts a completion. Returned by [`Parser::parse_at_cursor`].
#[derive(PartialEq, Clone, Debug, serde::Serialize)]
pub struct CompletionContext {
    /// What the grammar accepts at the cursor.
    pub expecting: Vec<ExpectedTokens>,
    /// The span `[replace_from, cursor)` the UI should replace — e.g. the `F`
    /// in `A1+F`. Equals the cursor when there is nothing to replace (right
    /// after `SUM(`).
    pub replace_from: usize,
}

#[derive(PartialEq, Clone, Debug)]
pub enum Node {
    BooleanKind(bool),
    NumberKind(f64),
    StringKind(String),
    ReferenceKind {
        sheet_name: Option<String>,
        sheet_index: u32,
        absolute_row: bool,
        absolute_column: bool,
        row: i32,
        column: i32,
    },
    RangeKind {
        sheet_name: Option<String>,
        sheet_index: u32,
        absolute_row1: bool,
        absolute_column1: bool,
        row1: i32,
        column1: i32,
        absolute_row2: bool,
        absolute_column2: bool,
        row2: i32,
        column2: i32,
    },
    WrongReferenceKind {
        sheet_name: Option<String>,
        absolute_row: bool,
        absolute_column: bool,
        row: i32,
        column: i32,
    },
    WrongRangeKind {
        sheet_name: Option<String>,
        absolute_row1: bool,
        absolute_column1: bool,
        row1: i32,
        column1: i32,
        absolute_row2: bool,
        absolute_column2: bool,
        row2: i32,
        column2: i32,
    },
    OpRangeKind {
        left: Box<Node>,
        right: Box<Node>,
    },
    OpConcatenateKind {
        left: Box<Node>,
        right: Box<Node>,
    },
    OpSumKind {
        kind: token::OpSum,
        left: Box<Node>,
        right: Box<Node>,
    },
    OpProductKind {
        kind: token::OpProduct,
        left: Box<Node>,
        right: Box<Node>,
    },
    OpPowerKind {
        left: Box<Node>,
        right: Box<Node>,
    },
    FunctionKind {
        kind: Function,
        args: Vec<Node>,
    },
    // LAMBDA(a,b, SQRT(a*a+b*b))
    LambdaDefKind {
        parameters: Vec<NamedVariable>,
        body: Box<Node>,
    },
    // LAMBDA(a,b, SQRT(a*a+b*b))(3,4)
    LambdaCallKind {
        lambda: Box<Node>,
        args: Vec<Node>,
    },
    NamedFunctionKind {
        id: Option<u32>,
        name: String,
        args: Vec<Node>,
    },
    ArrayKind(Vec<Vec<ArrayNode>>),
    DefinedNameKind(DefinedNameS),
    TableNameKind(String),
    NamedVariableKind {
        name: String,
        id: Option<u32>,
    },
    ImplicitIntersection {
        automatic: bool,
        child: Box<Node>,
    },
    SpillRangeOperator {
        child: Box<Node>,
    },
    CompareKind {
        kind: OpCompare,
        left: Box<Node>,
        right: Box<Node>,
    },
    UnaryKind {
        kind: OpUnary,
        right: Box<Node>,
    },
    ErrorKind(token::Error),
    ParseErrorKind {
        formula: String,
        message: String,
        position: usize,
        // What tokens were expected at this position.
        expecting: Vec<ExpectedTokens>,
    },
    EmptyArgKind,
}

#[derive(Clone)]
pub struct Parser<'a> {
    lexer: lexer::Lexer<'a>,
    worksheets: Vec<String>,
    defined_names: Vec<DefinedNameS>,
    context: CellReferenceRC,
    tables: HashMap<String, Table>,
    locale: &'a Locale,
    language: &'a Language,
    /// Completion hint for the position currently being parsed. The deepest
    /// frame that hits EOF stamps this onto its error. See `parse_at_cursor`.
    expecting_here: Vec<ExpectedTokens>,
    /// Set while parsing when an identifier turns out to be the last token in
    /// the input (its `peek` is EOF): the user is mid-typing a name there.
    /// Holds `(prefix, start_offset)`. Read by `parse_at_cursor` to offer
    /// function/name completion even when the surrounding parse succeeds (`SU`,
    /// `A1+F`) or fails for an unrelated reason (`IF(VLOOK`). See that method.
    trailing_name: Option<(String, usize)>,
}

pub fn new_parser_english<'a>(
    worksheets: Vec<String>,
    defined_names: Vec<DefinedNameS>,
    tables: HashMap<String, Table>,
) -> Parser<'a> {
    let locale = get_default_locale();
    let language = get_default_language();
    Parser::new(worksheets, defined_names, tables, locale, language)
}

impl<'a> Parser<'a> {
    pub fn new(
        worksheets: Vec<String>,
        defined_names: Vec<DefinedNameS>,
        tables: HashMap<String, Table>,
        locale: &'a Locale,
        language: &'a Language,
    ) -> Parser<'a> {
        let lexer = lexer::Lexer::new("", lexer::LexerMode::A1, locale, language);
        let context = CellReferenceRC {
            sheet: worksheets.first().map_or("", |v| v).to_string(),
            column: 1,
            row: 1,
        };
        Parser {
            lexer,
            worksheets,
            defined_names,
            context,
            tables,
            locale,
            language,
            expecting_here: vec![ExpectedTokens::Other],
            trailing_name: None,
        }
    }
    pub fn set_lexer_mode(&mut self, mode: lexer::LexerMode) {
        self.lexer.set_lexer_mode(mode)
    }

    pub fn set_locale(&mut self, locale: &'a Locale) {
        self.locale = locale;
        self.lexer.set_locale(locale);
    }

    pub fn set_language(&mut self, language: &'a Language) {
        self.language = language;
        self.lexer.set_language(language);
    }

    pub fn set_worksheets_and_names(
        &mut self,
        worksheets: Vec<String>,
        defined_names: Vec<DefinedNameS>,
    ) {
        self.worksheets = worksheets;
        self.defined_names = defined_names;
    }

    pub fn parse(&mut self, formula: &str, context: &CellReferenceRC) -> Node {
        self.lexer.set_formula(formula);
        self.context = context.clone();
        // At the top level a formula may start with an expression or a range.
        self.expecting_here = vec![ExpectedTokens::Range, ExpectedTokens::Other];
        self.trailing_name = None;
        self.parse_expr()
    }

    /// Parses `formula` up to `cursor` (a char offset) and reports what the
    /// grammar would accept at that position, so callers can offer completions.
    pub fn parse_at_cursor(
        &mut self,
        formula: &str,
        cursor: usize,
        context: &CellReferenceRC,
    ) -> CompletionContext {
        let head: String = formula.chars().take(cursor).collect();

        let node = self.parse(&head, context);

        // If the cursor sits on an identifier the user is mid-typing, the parser
        // recorded it as `trailing_name` while consuming it in a name position
        // (see `parse_primary`). That takes priority over the parse outcome: it
        // wins both when the surrounding parse *succeeds* (`SU`, `A1+F`) — where
        // there is no error to carry an `expecting` — and when it *fails* for an
        // unrelated reason (`IF(VLOOK`, where the EOF frame would otherwise
        // report the "argument of IF" hint).
        if let Some((prefix, start)) = self.trailing_name.take() {
            return CompletionContext {
                expecting: vec![ExpectedTokens::FunctionName(prefix)],
                replace_from: start,
            };
        }

        match node {
            // (a) The prefix is incomplete: the EOF frame stamped `expecting`.
            Node::ParseErrorKind {
                expecting,
                position,
                ..
            } => CompletionContext {
                expecting,
                replace_from: position,
            },
            // (b) The prefix parsed cleanly and there is no trailing bare name,
            // so there is nothing grammar-specific to offer.
            _ => CompletionContext {
                expecting: vec![ExpectedTokens::Other],
                replace_from: cursor,
            },
        }
    }

    // Returns the token used to separate arguments in functions and arrays
    // If the locale decimal separator is '.', then it is a comma ','
    // Otherwise, it is a semicolon ';'
    fn get_argument_separator_token(&self) -> TokenType {
        if self.locale.numbers.symbols.decimal == "." {
            TokenType::Comma
        } else {
            TokenType::Semicolon
        }
    }

    // Returns the token used to separate columns in arrays
    // If the locale decimal separator is '.', then it is a semicolon ';'
    fn get_column_separator_token(&self) -> TokenType {
        if self.locale.numbers.symbols.decimal == "." {
            TokenType::Semicolon
        } else {
            TokenType::Backslash
        }
    }

    fn get_sheet_index_by_name(&self, name: &str) -> Option<u32> {
        let worksheets = &self.worksheets;
        for (i, sheet) in worksheets.iter().enumerate() {
            if sheet == name {
                return Some(i as u32);
            }
        }
        None
    }

    // Returns:
    //  * None: If there is no defined name by that name
    //  * Some((Some(index), formula)): If there is a defined name local to that sheet
    //  * Some(None): If there is a global defined name
    fn get_defined_name(&self, name: &str, sheet: u32) -> Option<(Option<u32>, String)> {
        for (df_name, df_scope, df_formula) in &self.defined_names {
            if name.to_lowercase() == df_name.to_lowercase() && df_scope == &Some(sheet) {
                return Some((*df_scope, df_formula.to_owned()));
            }
        }
        for (df_name, df_scope, df_formula) in &self.defined_names {
            if name.to_lowercase() == df_name.to_lowercase() && df_scope.is_none() {
                return Some((None, df_formula.to_owned()));
            }
        }
        None
    }

    fn parse_expr(&mut self) -> Node {
        let mut t = self.parse_concat();
        if let Node::ParseErrorKind { .. } = t {
            return t;
        }
        let mut next_token = self.lexer.peek_token();
        while let TokenType::Compare(op) = next_token {
            self.lexer.advance_token();
            let p = self.parse_concat();
            if let Node::ParseErrorKind { .. } = p {
                return p;
            }
            t = Node::CompareKind {
                kind: op,
                left: Box::new(t),
                right: Box::new(p),
            };
            next_token = self.lexer.peek_token();
        }
        t
    }

    fn parse_concat(&mut self) -> Node {
        let mut t = self.parse_term();
        if let Node::ParseErrorKind { .. } = t {
            return t;
        }
        let mut next_token = self.lexer.peek_token();
        while next_token == TokenType::And {
            self.lexer.advance_token();
            let p = self.parse_term();
            if let Node::ParseErrorKind { .. } = p {
                return p;
            }
            t = Node::OpConcatenateKind {
                left: Box::new(t),
                right: Box::new(p),
            };
            next_token = self.lexer.peek_token();
        }
        t
    }

    fn parse_term(&mut self) -> Node {
        let mut t = self.parse_factor();
        if let Node::ParseErrorKind { .. } = t {
            return t;
        }
        let mut next_token = self.lexer.peek_token();
        while let TokenType::Addition(op) = next_token {
            self.lexer.advance_token();
            let p = self.parse_factor();
            if let Node::ParseErrorKind { .. } = p {
                return p;
            }
            t = Node::OpSumKind {
                kind: op,
                left: Box::new(t),
                right: Box::new(p),
            };

            next_token = self.lexer.peek_token();
        }
        t
    }

    fn parse_factor(&mut self) -> Node {
        let mut t = self.parse_prod();
        if let Node::ParseErrorKind { .. } = t {
            return t;
        }
        let mut next_token = self.lexer.peek_token();
        while let TokenType::Product(op) = next_token {
            self.lexer.advance_token();
            let p = self.parse_prod();
            if let Node::ParseErrorKind { .. } = p {
                return p;
            }
            t = Node::OpProductKind {
                kind: op,
                left: Box::new(t),
                right: Box::new(p),
            };
            next_token = self.lexer.peek_token();
        }
        t
    }

    fn parse_prod(&mut self) -> Node {
        let mut t = self.parse_power();
        if let Node::ParseErrorKind { .. } = t {
            return t;
        }
        let mut next_token = self.lexer.peek_token();
        while next_token == TokenType::Power {
            self.lexer.advance_token();
            let p = self.parse_power();
            if let Node::ParseErrorKind { .. } = p {
                return p;
            }
            t = Node::OpPowerKind {
                left: Box::new(t),
                right: Box::new(p),
            };
            next_token = self.lexer.peek_token();
        }
        t
    }

    fn parse_power(&mut self) -> Node {
        let mut next_token = self.lexer.peek_token();
        // Every minus is kept: two of them do not cancel out, `--x` turns `x`
        // into a number, which is what it is written for. A plus does nothing
        // at all, `+x` is `x`, text or boolean as it may be.
        let mut minus_count = 0;
        while let TokenType::Addition(op) = next_token {
            self.lexer.advance_token();
            if op == token::OpSum::Minus {
                minus_count += 1;
            }
            next_token = self.lexer.peek_token();
        }

        let mut t = self.parse_range();
        if let Node::ParseErrorKind { .. } = t {
            return t;
        }
        for _ in 0..minus_count {
            t = Node::UnaryKind {
                kind: token::OpUnary::Minus,
                right: Box::new(t),
            }
        }
        next_token = self.lexer.peek_token();
        while next_token == TokenType::Percent {
            self.lexer.advance_token();
            t = Node::UnaryKind {
                kind: token::OpUnary::Percentage,
                right: Box::new(t),
            };
            next_token = self.lexer.peek_token();
        }
        t
    }

    fn parse_range(&mut self) -> Node {
        let t = self.parse_implicit();
        if let Node::ParseErrorKind { .. } = t {
            return t;
        }
        let next_token = self.lexer.peek_token();
        if next_token == TokenType::Colon {
            self.lexer.advance_token();
            let p = self.parse_primary();
            if let Node::ParseErrorKind { .. } = p {
                return p;
            }
            return Node::OpRangeKind {
                left: Box::new(t),
                right: Box::new(p),
            };
        }
        t
    }

    fn parse_implicit(&mut self) -> Node {
        let next_token = self.lexer.peek_token();
        if next_token == TokenType::At {
            self.lexer.advance_token();
            let t = self.parse_primary();
            if let Node::ParseErrorKind { .. } = t {
                return t;
            }
            return Node::ImplicitIntersection {
                automatic: false,
                child: Box::new(t),
            };
        }
        let primary = self.parse_primary();
        if let Node::ParseErrorKind { .. } = primary {
            return primary;
        }
        let next_token = self.lexer.peek_token();
        if next_token == TokenType::Spill {
            self.lexer.advance_token();
            return Node::SpillRangeOperator {
                child: Box::new(primary),
            };
        }
        primary
    }

    fn parse_array_row(&mut self) -> Result<Vec<ArrayNode>, Node> {
        let mut row = Vec::new();
        let column_separator_token = self.get_argument_separator_token();
        // and array can only have numbers, string or booleans
        // otherwise it is a syntax error
        let first_element = match self.parse_expr() {
            Node::BooleanKind(s) => ArrayNode::Boolean(s),
            Node::NumberKind(s) => ArrayNode::Number(s),
            Node::StringKind(s) => ArrayNode::String(s),
            Node::ErrorKind(kind) => ArrayNode::Error(kind),
            Node::UnaryKind {
                kind: OpUnary::Minus,
                right,
            } => {
                if let Node::NumberKind(n) = *right {
                    ArrayNode::Number(-n)
                } else {
                    return Err(Node::ParseErrorKind {
                        formula: self.lexer.get_formula(),
                        expecting: vec![ExpectedTokens::Other],
                        message: "Invalid value in array".to_string(),
                        position: self.lexer.get_position() as usize,
                    });
                }
            }
            error @ Node::ParseErrorKind { .. } => return Err(error),
            _ => {
                return Err(Node::ParseErrorKind {
                    formula: self.lexer.get_formula(),
                    expecting: vec![ExpectedTokens::Other],
                    message: "Invalid value in array".to_string(),
                    position: self.lexer.get_position() as usize,
                });
            }
        };
        row.push(first_element);
        let mut next_token = self.lexer.peek_token();
        while next_token == column_separator_token {
            self.lexer.advance_token();
            let value = match self.parse_expr() {
                Node::BooleanKind(s) => ArrayNode::Boolean(s),
                Node::NumberKind(s) => ArrayNode::Number(s),
                Node::StringKind(s) => ArrayNode::String(s),
                Node::ErrorKind(kind) => ArrayNode::Error(kind),
                Node::UnaryKind {
                    kind: OpUnary::Minus,
                    right,
                } => {
                    if let Node::NumberKind(n) = *right {
                        ArrayNode::Number(-n)
                    } else {
                        return Err(Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            message: "Invalid value in array".to_string(),
                            position: self.lexer.get_position() as usize,
                        });
                    }
                }
                error @ Node::ParseErrorKind { .. } => return Err(error),
                _ => {
                    return Err(Node::ParseErrorKind {
                        formula: self.lexer.get_formula(),
                        expecting: vec![ExpectedTokens::Other],
                        message: "Invalid value in array".to_string(),
                        position: self.lexer.get_position() as usize,
                    });
                }
            };
            row.push(value);
            next_token = self.lexer.peek_token();
        }
        Ok(row)
    }

    fn parse_primary(&mut self) -> Node {
        let next_token = self.lexer.next_token();
        match next_token {
            TokenType::LeftParenthesis => {
                let t = self.parse_expr();
                if let Node::ParseErrorKind { .. } = t {
                    return t;
                }

                if let Err(err) = self.lexer.expect(TokenType::RightParenthesis) {
                    return Node::ParseErrorKind {
                        formula: self.lexer.get_formula(),
                        expecting: vec![ExpectedTokens::Other],
                        position: err.position,
                        message: err.message,
                    };
                }
                t
            }
            TokenType::Number(s) => Node::NumberKind(s),
            TokenType::String(s) => Node::StringKind(s),
            TokenType::LeftBrace => {
                // It's an array. It's a collection of rows all of the same dimension
                let column_separator_token = self.get_column_separator_token();

                let first_row = match self.parse_array_row() {
                    Ok(s) => s,
                    Err(error) => return error,
                };
                let length = first_row.len();

                let mut matrix = Vec::new();
                matrix.push(first_row);
                let mut next_token = self.lexer.peek_token();
                while next_token == column_separator_token {
                    self.lexer.advance_token();
                    let row = match self.parse_array_row() {
                        Ok(s) => s,
                        Err(error) => return error,
                    };
                    next_token = self.lexer.peek_token();
                    if row.len() != length {
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            position: self.lexer.get_position() as usize,
                            message: "All rows in an array should be the same length".to_string(),
                        };
                    }
                    matrix.push(row);
                }

                if let Err(err) = self.lexer.expect(TokenType::RightBrace) {
                    return Node::ParseErrorKind {
                        formula: self.lexer.get_formula(),
                        expecting: vec![ExpectedTokens::Other],
                        position: err.position,
                        message: err.message,
                    };
                }
                Node::ArrayKind(matrix)
            }
            TokenType::Reference {
                sheet,
                row,
                column,
                absolute_column,
                absolute_row,
            } => {
                let context = &self.context;
                let sheet_index = match &sheet {
                    Some(name) => self.get_sheet_index_by_name(name),
                    None => self.get_sheet_index_by_name(&context.sheet),
                };
                let a1_mode = self.lexer.is_a1_mode();
                let row = if absolute_row || !a1_mode {
                    row
                } else {
                    row - context.row
                };
                let column = if absolute_column || !a1_mode {
                    column
                } else {
                    column - context.column
                };
                match sheet_index {
                    Some(index) => Node::ReferenceKind {
                        sheet_name: sheet,
                        sheet_index: index,
                        row,
                        column,
                        absolute_row,
                        absolute_column,
                    },
                    None => Node::WrongReferenceKind {
                        sheet_name: sheet,
                        row,
                        column,
                        absolute_row,
                        absolute_column,
                    },
                }
            }
            TokenType::Range { sheet, left, right } => {
                let context = &self.context;
                let sheet_index = match &sheet {
                    Some(name) => self.get_sheet_index_by_name(name),
                    None => self.get_sheet_index_by_name(&context.sheet),
                };
                let mut row1 = left.row;
                let mut column1 = left.column;
                let mut row2 = right.row;
                let mut column2 = right.column;

                let mut absolute_column1 = left.absolute_column;
                let mut absolute_column2 = right.absolute_column;
                let mut absolute_row1 = left.absolute_row;
                let mut absolute_row2 = right.absolute_row;

                if self.lexer.is_a1_mode() {
                    if row1 > row2 {
                        (row2, row1) = (row1, row2);
                        (absolute_row2, absolute_row1) = (absolute_row1, absolute_row2);
                    }
                    if column1 > column2 {
                        (column2, column1) = (column1, column2);
                        (absolute_column2, absolute_column1) = (absolute_column1, absolute_column2);
                    }
                }

                if self.lexer.is_a1_mode() {
                    if !absolute_row1 {
                        row1 -= context.row
                    };
                    if !absolute_column1 {
                        column1 -= context.column
                    };
                    if !absolute_row2 {
                        row2 -= context.row
                    };
                    if !absolute_column2 {
                        column2 -= context.column
                    };
                }

                match sheet_index {
                    Some(index) => Node::RangeKind {
                        sheet_name: sheet,
                        sheet_index: index,
                        row1,
                        column1,
                        row2,
                        column2,
                        absolute_column1,
                        absolute_column2,
                        absolute_row1,
                        absolute_row2,
                    },
                    None => Node::WrongRangeKind {
                        sheet_name: sheet,
                        row1,
                        column1,
                        row2,
                        column2,
                        absolute_column1,
                        absolute_column2,
                        absolute_row1,
                        absolute_row2,
                    },
                }
            }
            TokenType::Ident(name) => {
                let next_token = self.lexer.peek_token();
                // If this identifier is the last token before the cursor (its
                // peek is EOF), the user is mid-typing a name here. Record it so
                // `parse_at_cursor` can offer function/name completion. We are in
                // a name/operand position by construction, so this never fires
                // for an identifier glued to a completed operand: the `m` in
                // `1m` is leftover input, never reached as a primary.
                if next_token == TokenType::EOF {
                    let end = self.lexer.get_position() as usize;
                    let start = end.saturating_sub(name.chars().count());
                    self.trailing_name = Some((name.clone(), start));
                }
                if next_token == TokenType::LeftParenthesis {
                    self.lexer.advance_token();
                    // It's a function call "SUM(.."
                    // _xlfn.LAMBDA(_xlpm.a,_xlpm.b, SQRT(_xlpm.a*_xlpm.a+_xlpm.b*_xlpm.b))(3,4)
                    if &name == "_xlfn.LAMBDA" || &name.to_uppercase() == "LAMBDA" {
                        return self.parse_lambda();
                    }
                    // The user-facing name, without the xlsx import prefixes.
                    let display_name = name
                        .trim_start_matches("_xlfn._xlws.")
                        .trim_start_matches("_xlfn.")
                        .trim_start_matches("_xlpm.")
                        .to_string();
                    let args = match self.parse_function_args(&display_name) {
                        Ok(s) => s,
                        Err(e) => return e,
                    };
                    if let Err(err) = self.lexer.expect(TokenType::RightParenthesis) {
                        // `SUM(A1` parses a complete argument and then fails to
                        // find the `)`. If we ran out of input we are still
                        // inside the call, sitting right after a complete
                        // argument: report the (correct) argument index so the
                        // signature tooltip works, but NOT `Range` — a fresh
                        // reference cannot begin after a complete operand. (A
                        // separator or `)` is what is expected here.)
                        let at_eof = err.position >= self.lexer.get_formula().chars().count();
                        let expecting = if at_eof {
                            let index = (args.len() as u32).max(1);
                            vec![ExpectedTokens::Argument(display_name.clone(), index)]
                        } else {
                            vec![ExpectedTokens::Other]
                        };
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting,
                            position: err.position,
                            message: err.message,
                        };
                    }
                    // We should do this *only* importing functions from xlsx: Implicit Intersection
                    if &name == "_xlfn.SINGLE" {
                        if args.len() != 1 {
                            return Node::ParseErrorKind {
                                formula: self.lexer.get_formula(),
                                expecting: vec![ExpectedTokens::Other],
                                position: self.lexer.get_position() as usize,
                                message: "Implicit Intersection requires just one argument"
                                    .to_string(),
                            };
                        }
                        return Node::ImplicitIntersection {
                            automatic: false,
                            child: Box::new(args[0].clone()),
                        };
                    }
                    // We should do this *only* importing functions from xlsx: Spill Range Operator
                    if &name == "_xlfn.ANCHORARRAY" {
                        if args.len() != 1 {
                            return Node::ParseErrorKind {
                                formula: self.lexer.get_formula(),
                                expecting: vec![ExpectedTokens::Other],
                                position: self.lexer.get_position() as usize,
                                message: "ANCHORARRAY requires one argument".to_string(),
                            };
                        }
                        return Node::SpillRangeOperator {
                            child: Box::new(args[0].clone()),
                        };
                    }
                    // We should do this *only* importing functions from xlsx
                    if let Some(function_kind) = self
                        .language
                        .functions
                        .lookup(name.trim_start_matches("_xlfn._xlws."))
                    {
                        return Node::FunctionKind {
                            kind: function_kind,
                            args,
                        };
                    }

                    if let Some(function_kind) = self
                        .language
                        .functions
                        .lookup(name.trim_start_matches("_xlfn."))
                    {
                        return Node::FunctionKind {
                            kind: function_kind,
                            args,
                        };
                    }
                    return Node::NamedFunctionKind {
                        name: name.trim_start_matches("_xlpm.").to_string(),
                        args,
                        id: None,
                    };
                }
                let context = &self.context;

                let context_sheet_index = match self.get_sheet_index_by_name(&context.sheet) {
                    Some(i) => i,
                    None => {
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            position: 0,
                            message: format!("sheet not found: {}", context.sheet),
                        };
                    }
                };

                // Could be a defined name or a table
                if let Some((scope, formula)) = self.get_defined_name(&name, context_sheet_index) {
                    return Node::DefinedNameKind((name, scope, formula));
                }
                let name_lower = name.to_lowercase();
                for table_name in self.tables.keys() {
                    if table_name.to_lowercase() == name_lower {
                        return Node::TableNameKind(name);
                    }
                }
                // xlpm: Excel Lambda Parameter
                let name = name.trim_start_matches("_xlpm.").to_string();
                Node::NamedVariableKind { name, id: None }
            }
            TokenType::Error(kind) => Node::ErrorKind(kind),
            TokenType::Illegal(error) => Node::ParseErrorKind {
                formula: self.lexer.get_formula(),
                expecting: vec![ExpectedTokens::Other],
                position: error.position,
                message: error.message,
            },
            TokenType::EOF => Node::ParseErrorKind {
                formula: self.lexer.get_formula(),
                // The deepest frame to reach EOF knows what it was expecting.
                expecting: self.expecting_here.clone(),
                position: self.lexer.get_position() as usize,
                message: "Unexpected end of input.".to_string(),
            },
            TokenType::Boolean(value) => {
                // Could be a function call "TRUE()"
                let next_token = self.lexer.peek_token();
                if next_token == TokenType::LeftParenthesis {
                    self.lexer.advance_token();
                    // We parse all the arguments, although technically this is moot
                    // But is has the upside of transforming `=TRUE( 4 )` into `=TRUE(4)`
                    let fn_name = if value { "TRUE" } else { "FALSE" };
                    let args = match self.parse_function_args(fn_name) {
                        Ok(s) => s,
                        Err(e) => return e,
                    };
                    if let Err(err) = self.lexer.expect(TokenType::RightParenthesis) {
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            position: err.position,
                            message: err.message,
                        };
                    }
                    if value {
                        return Node::FunctionKind {
                            kind: Function::True,
                            args,
                        };
                    } else {
                        return Node::FunctionKind {
                            kind: Function::False,
                            args,
                        };
                    }
                }
                Node::BooleanKind(value)
            }
            TokenType::Compare(_) => {
                // A primary Node cannot start with an operator
                Node::ParseErrorKind {
                    formula: self.lexer.get_formula(),
                    expecting: vec![ExpectedTokens::Other],
                    position: 0,
                    message: "Unexpected token: 'COMPARE'".to_string(),
                }
            }
            TokenType::Addition(_) => {
                // A primary Node cannot start with an operator
                Node::ParseErrorKind {
                    formula: self.lexer.get_formula(),
                    expecting: vec![ExpectedTokens::Other],
                    position: 0,
                    message: "Unexpected token: 'SUM'".to_string(),
                }
            }
            TokenType::Product(_) => {
                // A primary Node cannot start with an operator
                Node::ParseErrorKind {
                    formula: self.lexer.get_formula(),
                    expecting: vec![ExpectedTokens::Other],
                    position: 0,
                    message: "Unexpected token: 'PRODUCT'".to_string(),
                }
            }
            TokenType::Power => {
                // A primary Node cannot start with an operator
                Node::ParseErrorKind {
                    formula: self.lexer.get_formula(),
                    expecting: vec![ExpectedTokens::Other],
                    position: 0,
                    message: "Unexpected token: 'POWER'".to_string(),
                }
            }
            TokenType::At => {
                // A primary Node cannot start with an operator
                Node::ParseErrorKind {
                    formula: self.lexer.get_formula(),
                    expecting: vec![ExpectedTokens::Other],
                    position: 0,
                    message: "Unexpected token: '@'".to_string(),
                }
            }
            TokenType::RightParenthesis
            | TokenType::RightBracket
            | TokenType::Colon
            | TokenType::Semicolon
            | TokenType::Backslash
            | TokenType::RightBrace
            | TokenType::Comma
            | TokenType::Bang
            | TokenType::And
            | TokenType::Spill
            | TokenType::Percent => Node::ParseErrorKind {
                formula: self.lexer.get_formula(),
                expecting: vec![ExpectedTokens::Other],
                position: 0,
                message: format!("Unexpected token: '{next_token:?}'"),
            },
            TokenType::LeftBracket => Node::ParseErrorKind {
                formula: self.lexer.get_formula(),
                expecting: vec![ExpectedTokens::Other],
                position: 0,
                message: "Unexpected token: '['".to_string(),
            },
            TokenType::StructuredReference {
                table_name,
                specifier,
                table_reference,
            } => {
                // We will try to convert to a normal reference
                // table_name[column_name] => cell1:cell2
                // table_name[[#This Row], [column_name]:[column_name]] => cell1:cell2
                let context = &self.context;
                let context_sheet_index = match self.get_sheet_index_by_name(&context.sheet) {
                    Some(i) => i,
                    None => {
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            position: 0,
                            message: format!("sheet not found: {}", context.sheet),
                        };
                    }
                };
                // table-name => table
                let table = match self.tables.get(&table_name) {
                    Some(t) => t,
                    None => {
                        let message = format!(
                            "Table not found: '{table_name}' at '{}!{}{}'",
                            context.sheet,
                            number_to_column(context.column)
                                .unwrap_or(format!("{}", context.column)),
                            context.row
                        );
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            position: 0,
                            message,
                        };
                    }
                };
                let table_sheet_index = match self.get_sheet_index_by_name(&table.sheet_name) {
                    Some(i) => i,
                    None => {
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            position: 0,
                            message: format!("table sheet not found: {}", table.sheet_name),
                        };
                    }
                };

                let sheet_name = if table_sheet_index == context_sheet_index {
                    None
                } else {
                    Some(table.sheet_name.clone())
                };

                // context must be with tables.reference
                #[allow(clippy::expect_used)]
                let (column_start, mut row_start, column_end, mut row_end) =
                    parse_range(&table.reference).expect("Failed parsing range");

                let totals_row_count = table.totals_row_count as i32;
                let header_row_count = table.header_row_count as i32;
                row_end -= totals_row_count;

                match specifier {
                    Some(token::TableSpecifier::ThisRow) => {
                        row_start = context.row;
                        row_end = context.row;
                    }
                    Some(token::TableSpecifier::Totals) => {
                        if totals_row_count != 0 {
                            row_start = row_end + 1;
                            row_end = row_start;
                        } else {
                            // Table1[#Totals] is #REF! if Table1 does not have totals
                            return Node::ErrorKind(token::Error::REF);
                        }
                    }
                    Some(token::TableSpecifier::Headers) => {
                        row_end = row_start;
                    }
                    Some(token::TableSpecifier::Data) => {
                        row_start += header_row_count;
                    }
                    Some(token::TableSpecifier::All) => {
                        if totals_row_count != 0 {
                            row_end += 1;
                        }
                    }
                    None => {
                        // skip the headers
                        row_start += header_row_count;
                    }
                }
                match table_reference {
                    None => Node::RangeKind {
                        sheet_name,
                        sheet_index: table_sheet_index,
                        absolute_row1: true,
                        absolute_column1: true,
                        row1: row_start,
                        column1: column_start,
                        absolute_row2: true,
                        absolute_column2: true,
                        row2: row_end,
                        column2: column_end,
                    },
                    Some(TableReference::ColumnReference(s)) => {
                        let column_index = match get_table_column_by_name(&s, table) {
                            Some(s) => s + column_start,
                            None => {
                                return Node::ParseErrorKind {
                                    formula: self.lexer.get_formula(),
                                    expecting: vec![ExpectedTokens::Other],
                                    position: self.lexer.get_position() as usize,
                                    message: format!("Expecting column: {s} in table {table_name}"),
                                };
                            }
                        };
                        if row_start == row_end {
                            return Node::ReferenceKind {
                                sheet_name,
                                sheet_index: table_sheet_index,
                                absolute_row: true,
                                absolute_column: true,
                                row: row_start,
                                column: column_index,
                            };
                        }
                        Node::RangeKind {
                            sheet_name,
                            sheet_index: table_sheet_index,
                            absolute_row1: true,
                            absolute_column1: true,
                            row1: row_start,
                            column1: column_index,
                            absolute_row2: true,
                            absolute_column2: true,
                            row2: row_end,
                            column2: column_index,
                        }
                    }
                    Some(TableReference::RangeReference((left, right))) => {
                        let left_column_index = match get_table_column_by_name(&left, table) {
                            Some(f) => f + column_start,
                            None => {
                                return Node::ParseErrorKind {
                                    formula: self.lexer.get_formula(),
                                    expecting: vec![ExpectedTokens::Other],
                                    position: self.lexer.get_position() as usize,
                                    message: format!(
                                        "Expecting column: {left} in table {table_name}"
                                    ),
                                };
                            }
                        };

                        let right_column_index = match get_table_column_by_name(&right, table) {
                            Some(f) => f + column_start,
                            None => {
                                return Node::ParseErrorKind {
                                    formula: self.lexer.get_formula(),
                                    expecting: vec![ExpectedTokens::Other],
                                    position: self.lexer.get_position() as usize,
                                    message: format!(
                                        "Expecting column: {right} in table {table_name}"
                                    ),
                                };
                            }
                        };
                        Node::RangeKind {
                            sheet_name,
                            sheet_index: table_sheet_index,
                            absolute_row1: true,
                            absolute_column1: true,
                            row1: row_start,
                            column1: left_column_index,
                            absolute_row2: true,
                            absolute_column2: true,
                            row2: row_end,
                            column2: right_column_index,
                        }
                    }
                }
            }
        }
    }

    fn parse_function_args(&mut self, fn_name: &str) -> Result<Vec<Node>, Node> {
        let arg_separator_token = &self.get_argument_separator_token();
        let mut args: Vec<Node> = Vec::new();
        let mut next_token = self.lexer.peek_token();
        if next_token == TokenType::RightParenthesis {
            return Ok(args);
        }
        // The cursor is currently in the first argument of `fn_name`.
        self.set_argument_hint(fn_name, 1);
        if &self.lexer.peek_token() == arg_separator_token {
            args.push(Node::EmptyArgKind);
        } else {
            let t = self.parse_expr();
            if let Node::ParseErrorKind { .. } = t {
                return Err(t);
            }
            args.push(t);
        }
        next_token = self.lexer.peek_token();
        let mut arg_index = 1;
        while &next_token == arg_separator_token {
            self.lexer.advance_token();
            arg_index += 1;
            self.set_argument_hint(fn_name, arg_index);
            if &self.lexer.peek_token() == arg_separator_token {
                args.push(Node::EmptyArgKind);
                next_token = arg_separator_token.clone();
            } else if self.lexer.peek_token() == TokenType::RightParenthesis {
                args.push(Node::EmptyArgKind);
                return Ok(args);
            } else {
                let p = self.parse_expr();
                if let Node::ParseErrorKind { .. } = p {
                    return Err(p);
                }
                next_token = self.lexer.peek_token();
                args.push(p);
            }
        }
        Ok(args)
    }

    /// Records that the position currently being parsed *starts* argument
    /// `index` (1-based) of `fn_name`: a fresh operand goes here, so a `Range`
    /// is a valid completion. Reported if an EOF lands on this empty slot (e.g.
    /// `SUM(` or `SUM(A1,`). Once the argument is complete the unclosed-call
    /// path in `parse_primary` reports the argument context without `Range`.
    fn set_argument_hint(&mut self, fn_name: &str, index: u32) {
        self.expecting_here = vec![
            ExpectedTokens::Argument(fn_name.to_string(), index),
            ExpectedTokens::Range,
        ];
    }
}
