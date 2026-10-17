//! Desmos-like math: implicit multiply, `^`, comparisons, points.

use crate::error::{DesmosError, Result};
use crate::expr::{Expr, RelationKind, Restriction, Statement, is_builtin};
use crate::latex::normalize_latex;

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Name(String),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    LParen,
    RParen,
    Comma,
    Eq,
    Lt,
    Gt,
    Le,
    Ge,
    Pipe,
    LBrace,
    RBrace,
    Colon,
    Bang,
}

struct Lexer<'a> {
    src: &'a [u8],
    i: usize,
}

impl<'a> Lexer<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            src: src.as_bytes(),
            i: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.src.get(self.i).copied()
    }

    fn bump(&mut self) -> Option<u8> {
        let c = self.peek()?;
        self.i += 1;
        Some(c)
    }

    fn skip_ws(&mut self) {
        while self.peek().is_some_and(|c| c.is_ascii_whitespace()) {
            self.i += 1;
        }
    }

    fn next_token(&mut self) -> Result<Option<Token>> {
        self.skip_ws();
        let Some(c) = self.peek() else {
            return Ok(None);
        };
        match c {
            b'+' => {
                self.bump();
                Ok(Some(Token::Plus))
            }
            b'*' => {
                self.bump();
                Ok(Some(Token::Star))
            }
            b'/' => {
                self.bump();
                Ok(Some(Token::Slash))
            }
            b'^' => {
                self.bump();
                Ok(Some(Token::Caret))
            }
            b'(' => {
                self.bump();
                Ok(Some(Token::LParen))
            }
            b')' => {
                self.bump();
                Ok(Some(Token::RParen))
            }
            b',' => {
                self.bump();
                Ok(Some(Token::Comma))
            }
            b'-' => {
                self.bump();
                Ok(Some(Token::Minus))
            }
            b'|' => {
                self.bump();
                Ok(Some(Token::Pipe))
            }
            b'{' => {
                self.bump();
                Ok(Some(Token::LBrace))
            }
            b'}' => {
                self.bump();
                Ok(Some(Token::RBrace))
            }
            b':' => {
                self.bump();
                Ok(Some(Token::Colon))
            }
            b'!' => {
                self.bump();
                Ok(Some(Token::Bang))
            }
            b'=' => {
                self.bump();
                Ok(Some(Token::Eq))
            }
            b'<' => {
                self.bump();
                if self.peek() == Some(b'=') {
                    self.bump();
                    Ok(Some(Token::Le))
                } else {
                    Ok(Some(Token::Lt))
                }
            }
            b'>' => {
                self.bump();
                if self.peek() == Some(b'=') {
                    self.bump();
                    Ok(Some(Token::Ge))
                } else {
                    Ok(Some(Token::Gt))
                }
            }
            b'0'..=b'9' | b'.' => Ok(Some(Token::Number(self.number()?))),
            b'a'..=b'z' | b'A'..=b'Z' | b'_' => Ok(Some(Token::Name(self.name()))),
            _ => Err(DesmosError::Syntax(format!("unexpected '{}'", c as char))),
        }
    }

    fn number(&mut self) -> Result<f64> {
        let start = self.i;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.bump();
        }
        if self.peek() == Some(b'.') {
            self.bump();
            while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                self.bump();
            }
        }
        // Only treat `e`/`E` as a scientific exponent when digits follow.
        // Otherwise `2e` / `2e^{x}` stay as number + name (Desmos: `2·e`).
        if matches!(self.peek(), Some(b'e' | b'E'))
            && self.src.get(self.i + 1).is_some_and(u8::is_ascii_digit)
        {
            self.bump();
            while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                self.bump();
            }
        }
        let raw = std::str::from_utf8(&self.src[start..self.i]).unwrap_or("");
        raw.parse()
            .map_err(|_| DesmosError::Syntax(format!("invalid number {raw}")))
    }

    fn name(&mut self) -> String {
        let start = self.i;
        while self
            .peek()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == b'_')
        {
            self.bump();
        }
        String::from_utf8_lossy(&self.src[start..self.i]).into_owned()
    }
}

struct Parser {
    tokens: Vec<Token>,
    i: usize,
    stop_at_pipe: bool,
}

impl Parser {
    fn parse(source: &str) -> Result<Statement> {
        let source = normalize_latex(source);
        let mut lexer = Lexer::new(&source);
        let mut tokens = Vec::new();
        while let Some(token) = lexer.next_token()? {
            tokens.push(token);
        }
        if tokens.is_empty() {
            return Err(DesmosError::Syntax("empty expression".into()));
        }
        let mut parser = Self {
            tokens,
            i: 0,
            stop_at_pipe: false,
        };
        let stmt = parser.statement()?;
        if parser.peek().is_some() {
            return Err(DesmosError::Syntax("unexpected trailing input".into()));
        }
        Ok(stmt)
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.i)
    }

    fn bump(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.i).cloned()?;
        self.i += 1;
        Some(token)
    }

    fn statement(&mut self) -> Result<Statement> {
        if let Some(Token::Name(name)) = self.peek().cloned() {
            if self.tokens.get(self.i + 1) == Some(&Token::Eq) {
                let is_xy = name == "x" || name == "y";
                self.bump();
                self.bump();
                let right = self.expression()?;
                if is_xy || right.uses("x") || right.uses("y") || name == "r" {
                    return self.with_restrict(Statement::Relation {
                        left: Some(Expr::Name(name)),
                        kind: RelationKind::Equal,
                        right,
                        restrict: Vec::new(),
                    });
                }
                return Ok(Statement::Assignment { name, value: right });
            }
            if self.tokens.get(self.i + 1) == Some(&Token::LParen)
                && let Some(eq_at) = self.matching_paren_then_eq(self.i + 1)
            {
                self.bump();
                self.bump();
                let mut params = Vec::new();
                if !matches!(self.peek(), Some(Token::RParen)) {
                    loop {
                        match self.bump() {
                            Some(Token::Name(param)) => params.push(param),
                            _ => return Err(DesmosError::Syntax("expected parameter".into())),
                        }
                        match self.bump() {
                            Some(Token::Comma) => {}
                            Some(Token::RParen) => break,
                            _ => return Err(DesmosError::Syntax("expected ',' or ')'".into())),
                        }
                    }
                } else {
                    self.bump();
                }
                if self.i != eq_at + 1 {
                    return Err(DesmosError::Syntax("malformed function".into()));
                }
                self.bump();
                let body = self.expression()?;
                return Ok(Statement::Function { name, params, body });
            }
        }

        let left = self.expression()?;
        let kind = match self.try_rel_kind() {
            Some(kind) => kind,
            None => {
                return self.with_restrict(Statement::Relation {
                    left: None,
                    kind: RelationKind::Equal,
                    right: left,
                    restrict: Vec::new(),
                });
            }
        };
        let right = self.expression()?;
        self.with_restrict(Statement::Relation {
            left: Some(left),
            kind,
            right,
            restrict: Vec::new(),
        })
    }

    fn with_restrict(&mut self, mut stmt: Statement) -> Result<Statement> {
        if self.peek() != Some(&Token::LBrace) {
            return Ok(stmt);
        }
        let restrict = self.restrictions()?;
        if let Statement::Relation { restrict: slot, .. } = &mut stmt {
            *slot = restrict;
        }
        Ok(stmt)
    }

    fn try_rel_kind(&mut self) -> Option<RelationKind> {
        let kind = match self.peek()? {
            Token::Eq => RelationKind::Equal,
            Token::Lt => RelationKind::Lt,
            Token::Gt => RelationKind::Gt,
            Token::Le => RelationKind::Le,
            Token::Ge => RelationKind::Ge,
            _ => return None,
        };
        self.bump();
        Some(kind)
    }

    fn restrictions(&mut self) -> Result<Vec<Restriction>> {
        self.bump();
        let mut out = Vec::new();
        loop {
            out.extend(self.restriction_chain()?);
            match self.bump() {
                Some(Token::Comma) => {}
                Some(Token::RBrace) => return Ok(out),
                _ => return Err(DesmosError::Syntax("expected ',' or '}'".into())),
            }
        }
    }

    fn restriction_chain(&mut self) -> Result<Vec<Restriction>> {
        let first = self.expression()?;
        let kind1 = self
            .try_rel_kind()
            .ok_or_else(|| DesmosError::Syntax("expected a comparison".into()))?;
        let mid = self.expression()?;
        let mut out = vec![Restriction {
            left: first,
            kind: kind1,
            right: mid.clone(),
        }];
        if let Some(kind2) = self.try_rel_kind() {
            let last = self.expression()?;
            out.push(Restriction {
                left: mid,
                kind: kind2,
                right: last,
            });
        }
        Ok(out)
    }

    fn matching_paren_then_eq(&self, lparen_at: usize) -> Option<usize> {
        let mut depth = 0;
        for (idx, token) in self.tokens.iter().enumerate().skip(lparen_at) {
            match token {
                Token::LParen => depth += 1,
                Token::RParen => {
                    depth -= 1;
                    if depth == 0 {
                        return (self.tokens.get(idx + 1) == Some(&Token::Eq)).then_some(idx);
                    }
                }
                _ => {}
            }
        }
        None
    }

    fn expression(&mut self) -> Result<Expr> {
        self.expr_bp(0)
    }

    fn expr_bp(&mut self, min_bp: u8) -> Result<Expr> {
        let mut lhs = self.prefix()?;
        loop {
            if self.peek() == Some(&Token::Bang) && min_bp <= 10 {
                self.bump();
                lhs = Expr::Fact(Box::new(lhs));
                continue;
            }
            // Implicit multiply binds between `*` (3/4) and `^` (8/7), so an
            // exponent operand stops before following terms (`x^{2}y` → `x^2*y`).
            if !self.stop_at_pipe && self.peek() == Some(&Token::Pipe) && min_bp <= 5 {
                let rhs = self.prefix()?;
                lhs = Expr::Mul(Box::new(lhs), Box::new(rhs));
                continue;
            }
            if self.should_implicit_mul() && min_bp <= 5 {
                let rhs = self.expr_bp(6)?;
                lhs = Expr::Mul(Box::new(lhs), Box::new(rhs));
                continue;
            }
            let Some((lbp, rbp, op)) = self.infix_bp() else {
                break;
            };
            if lbp < min_bp {
                break;
            }
            self.bump();
            let rhs = self.expr_bp(rbp)?;
            lhs = match op {
                Token::Plus => Expr::Add(Box::new(lhs), Box::new(rhs)),
                Token::Minus => Expr::Sub(Box::new(lhs), Box::new(rhs)),
                Token::Star => Expr::Mul(Box::new(lhs), Box::new(rhs)),
                Token::Slash => Expr::Div(Box::new(lhs), Box::new(rhs)),
                Token::Caret => Expr::Pow(Box::new(lhs), Box::new(rhs)),
                _ => unreachable!(),
            };
        }
        Ok(lhs)
    }

    fn prefix(&mut self) -> Result<Expr> {
        match self.bump() {
            Some(Token::Number(n)) => Ok(Expr::Number(n)),
            Some(Token::Name(name)) => {
                if self.peek() == Some(&Token::LParen)
                    && (is_builtin(&name) || self.looks_like_call())
                {
                    self.bump();
                    let args = self.args()?;
                    Ok(Expr::Call(name, args))
                } else if is_builtin(&name) && self.starts_value() {
                    // Include products in the unparenthesized arg (`\sin 2x`).
                    let arg = self.expr_bp(5)?;
                    Ok(Expr::Call(name, vec![arg]))
                } else {
                    Ok(expand_juxtaposed_name(name))
                }
            }
            Some(Token::Minus) => Ok(Expr::Neg(Box::new(self.expr_bp(9)?))),
            Some(Token::Pipe) => {
                let prev = self.stop_at_pipe;
                self.stop_at_pipe = true;
                let inner = self.expression();
                self.stop_at_pipe = prev;
                let inner = inner?;
                if self.bump() != Some(Token::Pipe) {
                    return Err(DesmosError::Syntax("expected '|'".into()));
                }
                Ok(Expr::Abs(Box::new(inner)))
            }
            Some(Token::LBrace) => self.piecewise(),
            Some(Token::LParen) => {
                let first = self.expression()?;
                if self.peek() == Some(&Token::Comma) {
                    self.bump();
                    let second = self.expression()?;
                    if self.bump() != Some(Token::RParen) {
                        return Err(DesmosError::Syntax("expected ')'".into()));
                    }
                    return Ok(Expr::Point(Box::new(first), Box::new(second)));
                }
                if self.bump() != Some(Token::RParen) {
                    return Err(DesmosError::Syntax("expected ')'".into()));
                }
                Ok(first)
            }
            _ => Err(DesmosError::Syntax("expected a value".into())),
        }
    }

    fn piecewise(&mut self) -> Result<Expr> {
        let mut arms = Vec::new();
        loop {
            let cond_or_value = self.comparison_expr()?;
            if self.peek() == Some(&Token::Colon) {
                self.bump();
                let value = self.expression()?;
                arms.push((Some(cond_or_value), value));
            } else {
                arms.push((None, cond_or_value));
            }
            match self.bump() {
                Some(Token::Comma) => {}
                Some(Token::RBrace) => break,
                _ => return Err(DesmosError::Syntax("expected ',' or '}'".into())),
            }
        }
        if arms.is_empty() {
            return Err(DesmosError::Syntax("empty piecewise".into()));
        }
        Ok(Expr::Piecewise(arms))
    }

    fn comparison_expr(&mut self) -> Result<Expr> {
        let left = self.expression()?;
        if let Some(kind) = self.try_rel_kind() {
            let right = self.expression()?;
            return Ok(Expr::Cmp(Box::new(left), kind, Box::new(right)));
        }
        Ok(left)
    }

    fn starts_value(&self) -> bool {
        matches!(
            self.peek(),
            Some(
                Token::Number(_)
                    | Token::Name(_)
                    | Token::LParen
                    | Token::Pipe
                    | Token::LBrace
                    | Token::Minus
            )
        )
    }

    fn looks_like_call(&self) -> bool {
        // `f(x)=` is a definition, handled earlier. `f(1)` or `sin(x)` is a call.
        matches!(
            self.tokens.get(self.i + 1),
            Some(Token::Number(_) | Token::Name(_) | Token::LParen | Token::Minus)
        )
    }

    fn args(&mut self) -> Result<Vec<Expr>> {
        let mut args = Vec::new();
        if self.peek() == Some(&Token::RParen) {
            self.bump();
            return Ok(args);
        }
        loop {
            args.push(self.expression()?);
            match self.bump() {
                Some(Token::Comma) => {}
                Some(Token::RParen) => return Ok(args),
                _ => return Err(DesmosError::Syntax("expected ',' or ')'".into())),
            }
        }
    }

    fn infix_bp(&self) -> Option<(u8, u8, Token)> {
        match self.peek()? {
            Token::Plus | Token::Minus => Some((1, 2, self.peek()?.clone())),
            Token::Star | Token::Slash => Some((3, 4, self.peek()?.clone())),
            Token::Caret => Some((8, 7, Token::Caret)),
            _ => None,
        }
    }

    fn should_implicit_mul(&self) -> bool {
        matches!(
            self.peek(),
            Some(Token::Number(_) | Token::Name(_) | Token::LParen)
        )
    }
}

/// Parse one expression-list line.
pub fn parse_statement(source: &str) -> Result<Statement> {
    Parser::parse(source.trim())
}

/// Desmos treats `mx` as `m*x` unless the name is reserved or subscripted.
fn expand_juxtaposed_name(name: String) -> Expr {
    use crate::expr::is_reserved;
    if name.len() <= 1 || name.contains('_') || is_reserved(&name) || is_builtin(&name) {
        return Expr::Name(name);
    }
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return Expr::Name(name);
    };
    let mut expr = Expr::Name(first.to_string());
    for ch in chars {
        if ch.is_ascii_digit()
            && let Expr::Name(last) = &mut expr
        {
            last.push(ch);
            continue;
        }
        expr = Expr::Mul(Box::new(expr), Box::new(Expr::Name(ch.to_string())));
    }
    expr
}

#[cfg(test)]
mod test;
