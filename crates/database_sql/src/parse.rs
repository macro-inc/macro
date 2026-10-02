//! Stage one: SQL text to the subset AST.
//!
//! ```text
//! statement := select | insert | update | delete | alter
//! select    := SELECT [DISTINCT] items FROM source {join} [WHERE cond] [GROUP BY column]
//!              [ORDER BY order {, order}] [LIMIT int [OFFSET int]]
//! items     := '*' | item [[AS] name] {, item [[AS] name]}
//! item      := column | agg
//! agg       := COUNT '(' '*' ')' | (COUNT|SUM|AVG|MIN|MAX) '(' column ')'
//! source    := table [[AS] alias]
//! join      := [INNER] JOIN source ON pair {AND pair} | LEFT [OUTER] JOIN source ON pair {AND pair}
//! pair      := column (= | HAS) column
//! table     := [ident '.'] ident
//! column    := [alias '.'] ident
//! order     := (column | agg | int) [ASC | DESC]
//! cond      := and {OR and}
//! and       := term {AND term}
//! term      := '(' cond ')' | atom
//! atom      := column cmp lit
//!            | column [NOT] IN '(' lit {, lit} ')'
//!            | column [NOT] HAS lit
//!            | column IS [NOT] NULL
//!            | column [NOT] LIKE string [ESCAPE string]
//! lit       := string | number | TRUE | FALSE | NULL
//! insert    := INSERT INTO table '(' ident {, ident} ')' VALUES row {, row}
//!            | INSERT INTO table DEFAULT VALUES
//! row       := '(' value {, value} ')'
//! value     := lit | '[' lit {, lit} ']'          -- a list for a multi-valued cell
//! update    := UPDATE table SET ident '=' set {, ident '=' set} WHERE cond
//! set       := value | ident                     -- a column copies the row's own value
//! delete    := DELETE FROM table WHERE cond
//! alter     := ALTER TABLE table ALTER [COLUMN] ident TYPE type
//! type      := (text | number | boolean | date | link | select | select_number | tag
//!              | entity '(' kind ')') ['[' ']']      -- [] for a multi-valued column
//! ```
//!
//! Keywords are case-insensitive; identifiers keep their case. `ALTER`,
//! `TABLE`, `COLUMN`, `TYPE`, `USING`, `ESCAPE` and the type names are read
//! as words, so a column may still be called `type`. A trailing `;` is
//! allowed. Everything else SQL has (subqueries, arithmetic, functions beyond
//! the five aggregates, `HAVING`, an `UPDATE`/`DELETE` without a `WHERE`) is
//! a parse error with a span and a message written for the agent that sent
//! it.

pub mod ast;
mod lexer;
mod parser;
#[cfg(test)]
mod test;

use std::ops::Range;

pub use ast::*;

/// Why a statement could not be parsed, with the byte range it points at.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct ParseError {
    /// Byte range in the source the message is about. Empty at end of input.
    #[specta(type = Span)]
    pub span: Range<usize>,
    /// What was expected and what was found, in words an agent can act on.
    pub message: String,
}

// By hand: specta's derive cannot read a thiserror format that names a
// field's field.
impl std::fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{} at byte {}", self.message, self.span.start)
    }
}

impl std::error::Error for ParseError {}

/// A byte range as it crosses the wasm boundary: `{start, end}`.
#[derive(specta::Type)]
#[expect(
    dead_code,
    reason = "only its shape is exported, for the span of a ParseError"
)]
struct Span {
    start: u32,
    end: u32,
}

/// Parse one statement.
pub fn parse(sql: &str) -> Result<Statement, ParseError> {
    let tokens = lexer::lex(sql)?;
    parser::statement(&tokens, sql.len())
}
