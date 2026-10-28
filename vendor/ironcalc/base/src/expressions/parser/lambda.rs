use crate::expressions::parser::{ExpectedTokens, NamedVariable, Node, Parser};
use crate::expressions::token::TokenType;

impl<'a> Parser<'a> {
    // Called after `LAMBDA` and the opening `(` have been consumed.
    // Parses:  (param | '[' param ']')*, body ')' ['(' call_args ')']
    // Returns LambdaDefKind, or LambdaCallKind if immediately invoked.
    pub(crate) fn parse_lambda(&mut self) -> Node {
        let arg_separator = self.get_argument_separator_token();

        if self.lexer.peek_token() == TokenType::RightParenthesis {
            self.lexer.advance_token();
            return Node::ParseErrorKind {
                formula: self.lexer.get_formula(),
                expecting: vec![ExpectedTokens::Other],
                position: self.lexer.get_position() as usize,
                message: "LAMBDA requires at least one argument (the body)".to_string(),
            };
        }

        let mut parameters = Vec::new();

        // Parse items one by one. Items followed by the separator are parameters (must
        // be plain names or [name]). The final item before ')' is the body expression.
        let mut arg_index = 1;
        let body = loop {
            // The cursor is currently in item `arg_index` of LAMBDA, so an EOF
            // here reports the argument context for the Formula Helper. LAMBDA
            // is parsed specially (not through `parse_function_args`), so this
            // hint has to be stamped explicitly.
            self.set_argument_hint("LAMBDA", arg_index);

            // Optional parameter syntax: [name]
            let bracket_optional = self.lexer.peek_token() == TokenType::LeftBracket;
            if bracket_optional {
                // consume '['
                self.lexer.advance_token();
            }

            let expr = self.parse_expr();
            if let Node::ParseErrorKind { .. } = expr {
                return expr;
            }

            if bracket_optional {
                if let Err(err) = self.lexer.expect(TokenType::RightBracket) {
                    return Node::ParseErrorKind {
                        formula: self.lexer.get_formula(),
                        expecting: vec![ExpectedTokens::Other],
                        position: err.position,
                        message: "Expected ']' after optional parameter name".to_string(),
                    };
                }
            }

            let next = self.lexer.peek_token();
            if next == arg_separator {
                // This item must be a parameter name.
                self.lexer.advance_token();
                arg_index += 1;
                match expr {
                    Node::NamedVariableKind { name, id } => {
                        // xlop: Excel Optional Parameter.
                        let (clean, is_optional) = if let Some(s) = name.strip_prefix("_xlop.") {
                            (s.to_string(), true)
                        } else {
                            (name, bracket_optional)
                        };
                        parameters.push(NamedVariable {
                            name: clean,
                            id,
                            is_optional,
                        });
                    }
                    _ => {
                        return Node::ParseErrorKind {
                            formula: self.lexer.get_formula(),
                            expecting: vec![ExpectedTokens::Other],
                            position: self.lexer.get_position() as usize,
                            message: "LAMBDA parameter must be a name".to_string(),
                        };
                    }
                }
            } else if next == TokenType::RightParenthesis {
                self.lexer.advance_token(); // consume ')'
                break expr;
            } else {
                return Node::ParseErrorKind {
                    formula: self.lexer.get_formula(),
                    expecting: vec![ExpectedTokens::Other],
                    position: self.lexer.get_position() as usize,
                    message: "Expected ',' or ')' in LAMBDA".to_string(),
                };
            }
        };

        let def = Node::LambdaDefKind {
            parameters,
            body: Box::new(body),
        };

        // Immediate invocation: LAMBDA(params, body)(call_args)
        if self.lexer.peek_token() == TokenType::LeftParenthesis {
            self.lexer.advance_token(); // consume '('
            let call_args = match self.parse_function_args("LAMBDA") {
                Ok(args) => args,
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
            return Node::LambdaCallKind {
                lambda: Box::new(def),
                args: call_args,
            };
        }

        def
    }
}
