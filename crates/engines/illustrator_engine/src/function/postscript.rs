//! The PostScript calculator of type 4 functions: arithmetic, relational,
//! boolean and bitwise, and stack operators with `if` and `ifelse`. A
//! program is compiled once to flat code whose jumps only go forward, so a
//! run takes at most one step per instruction, on a stack of at most 100
//! operands.

use crate::error::{AiError, Result};

/// Operands the stack holds (the PDF limit).
const STACK: usize = 100;
/// Procedures nested in procedures.
const MAX_NESTING: usize = 64;
/// Instructions a program compiles to.
const MAX_CODE: usize = 1 << 16;

/// An operand.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Value {
    Int(i64),
    Real(f64),
    Bool(bool),
}

impl Value {
    fn real(self) -> Option<f64> {
        match self {
            Value::Int(i) => Some(i as f64),
            Value::Real(r) => Some(r),
            Value::Bool(_) => None,
        }
    }

    /// An integer operand (reals truncated, as lenient readers do).
    fn int(self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(i),
            Value::Real(r) if r.is_finite() && r.abs() < 9.0e15 => Some(r.trunc() as i64),
            _ => None,
        }
    }
}

/// An operator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Abs,
    Add,
    Atan,
    Ceiling,
    Cos,
    Cvi,
    Cvr,
    Div,
    Exp,
    Floor,
    Idiv,
    Ln,
    Log,
    Mod,
    Mul,
    Neg,
    Round,
    Sin,
    Sqrt,
    Sub,
    Truncate,
    And,
    Bitshift,
    Eq,
    Ge,
    Gt,
    Le,
    Lt,
    Ne,
    Not,
    Or,
    Xor,
    Copy,
    Dup,
    Exch,
    Index,
    Pop,
    Roll,
}

impl Op {
    fn from_name(name: &[u8]) -> Option<Op> {
        Some(match name {
            b"abs" => Op::Abs,
            b"add" => Op::Add,
            b"atan" => Op::Atan,
            b"ceiling" => Op::Ceiling,
            b"cos" => Op::Cos,
            b"cvi" => Op::Cvi,
            b"cvr" => Op::Cvr,
            b"div" => Op::Div,
            b"exp" => Op::Exp,
            b"floor" => Op::Floor,
            b"idiv" => Op::Idiv,
            b"ln" => Op::Ln,
            b"log" => Op::Log,
            b"mod" => Op::Mod,
            b"mul" => Op::Mul,
            b"neg" => Op::Neg,
            b"round" => Op::Round,
            b"sin" => Op::Sin,
            b"sqrt" => Op::Sqrt,
            b"sub" => Op::Sub,
            b"truncate" => Op::Truncate,
            b"and" => Op::And,
            b"bitshift" => Op::Bitshift,
            b"eq" => Op::Eq,
            b"ge" => Op::Ge,
            b"gt" => Op::Gt,
            b"le" => Op::Le,
            b"lt" => Op::Lt,
            b"ne" => Op::Ne,
            b"not" => Op::Not,
            b"or" => Op::Or,
            b"xor" => Op::Xor,
            b"copy" => Op::Copy,
            b"dup" => Op::Dup,
            b"exch" => Op::Exch,
            b"index" => Op::Index,
            b"pop" => Op::Pop,
            b"roll" => Op::Roll,
            _ => return None,
        })
    }
}

/// One step of compiled code.
#[derive(Clone, Debug, PartialEq)]
enum Instr {
    Push(Value),
    Op(Op),
    /// Pops a boolean; jumps when it is false.
    JumpUnless(usize),
    Jump(usize),
}

/// A compiled calculator program.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Program {
    code: Vec<Instr>,
}

/// A parsed program element.
enum Node {
    Push(Value),
    Op(Op),
    Proc(Vec<Node>),
    If,
    IfElse,
}

fn corrupt(what: &str) -> AiError {
    AiError::corrupt(format!("PostScript function: {what}"))
}

impl Program {
    /// Compiles a program's text (`{ … }`).
    pub(crate) fn compile(src: &[u8]) -> Result<Program> {
        let mut lexer = Lexer { src, at: 0 };
        match lexer.next() {
            Some(Token::Open) => {}
            _ => return Err(corrupt("missing `{`")),
        }
        let nodes = parse_proc(&mut lexer, 0)?;
        let mut code = Vec::new();
        emit(&nodes, &mut code)?;
        Ok(Program { code })
    }

    /// Runs with `inputs` on the stack; the topmost `outputs.len()` values
    /// are the outputs. `false` (outputs untouched) when the program fails:
    /// a stack overflow or underflow, or an operand of the wrong type.
    pub(crate) fn run(&self, inputs: &[f32], outputs: &mut [f32]) -> bool {
        let mut stack = Stack {
            items: [Value::Int(0); STACK],
            len: 0,
        };
        for &x in inputs {
            if stack.push(Value::Real(f64::from(x))).is_none() {
                return false;
            }
        }
        if self.execute(&mut stack).is_none() || stack.len < outputs.len() {
            return false;
        }
        let top = &stack.items[stack.len - outputs.len()..stack.len];
        for (out, v) in outputs.iter_mut().zip(top) {
            *out = match *v {
                Value::Bool(b) => f32::from(u8::from(b)),
                v => v.real().unwrap_or(0.0) as f32,
            };
        }
        true
    }

    fn execute(&self, stack: &mut Stack) -> Option<()> {
        let mut pc = 0;
        while let Some(instr) = self.code.get(pc) {
            pc += 1;
            match *instr {
                Instr::Push(v) => stack.push(v)?,
                Instr::Op(op) => stack.apply(op)?,
                Instr::JumpUnless(to) => {
                    // A number for the condition is read as true when not
                    // zero, as lenient readers do.
                    let truth = match stack.pop()? {
                        Value::Bool(b) => b,
                        v => v.real()? != 0.0,
                    };
                    if !truth {
                        pc = to;
                    }
                }
                Instr::Jump(to) => pc = to,
            }
        }
        Some(())
    }
}

/// Parses a procedure's body after its `{`, through its `}`.
fn parse_proc(lexer: &mut Lexer<'_>, depth: usize) -> Result<Vec<Node>> {
    if depth > MAX_NESTING {
        return Err(corrupt("procedures nested too deeply"));
    }
    let mut nodes = Vec::new();
    loop {
        let node = match lexer.next() {
            None => return Err(corrupt("missing `}`")),
            Some(Token::Close) => return Ok(nodes),
            Some(Token::Open) => Node::Proc(parse_proc(lexer, depth + 1)?),
            Some(Token::Number(v)) => Node::Push(v),
            Some(Token::Word(w)) => match w {
                b"if" => Node::If,
                b"ifelse" => Node::IfElse,
                b"true" => Node::Push(Value::Bool(true)),
                b"false" => Node::Push(Value::Bool(false)),
                _ => Node::Op(Op::from_name(w).ok_or_else(|| {
                    corrupt(&format!("unknown operator {}", String::from_utf8_lossy(w)))
                })?),
            },
        };
        nodes.push(node);
    }
}

/// Emits flat code for a procedure body.
fn emit(nodes: &[Node], code: &mut Vec<Instr>) -> Result<()> {
    let mut i = 0;
    while i < nodes.len() {
        if code.len() > MAX_CODE {
            return Err(corrupt("program too long"));
        }
        match &nodes[i] {
            Node::Push(v) => code.push(Instr::Push(*v)),
            Node::Op(op) => code.push(Instr::Op(*op)),
            Node::Proc(then) => match (nodes.get(i + 1), nodes.get(i + 2)) {
                (Some(Node::If), _) => {
                    let at = code.len();
                    code.push(Instr::JumpUnless(0));
                    emit(then, code)?;
                    code[at] = Instr::JumpUnless(code.len());
                    i += 1;
                }
                (Some(Node::Proc(otherwise)), Some(Node::IfElse)) => {
                    let at = code.len();
                    code.push(Instr::JumpUnless(0));
                    emit(then, code)?;
                    let skip = code.len();
                    code.push(Instr::Jump(0));
                    code[at] = Instr::JumpUnless(code.len());
                    emit(otherwise, code)?;
                    code[skip] = Instr::Jump(code.len());
                    i += 2;
                }
                _ => return Err(corrupt("procedure without `if` or `ifelse`")),
            },
            Node::If | Node::IfElse => return Err(corrupt("`if` without a procedure")),
        }
        i += 1;
    }
    Ok(())
}

/// The operand stack.
struct Stack {
    items: [Value; STACK],
    len: usize,
}

impl Stack {
    fn push(&mut self, v: Value) -> Option<()> {
        let slot = self.items.get_mut(self.len)?;
        *slot = v;
        self.len += 1;
        Some(())
    }

    fn pop(&mut self) -> Option<Value> {
        self.len = self.len.checked_sub(1)?;
        Some(self.items[self.len])
    }

    fn pop_real(&mut self) -> Option<f64> {
        self.pop()?.real()
    }

    fn pop_int(&mut self) -> Option<i64> {
        self.pop()?.int()
    }

    fn apply(&mut self, op: Op) -> Option<()> {
        match op {
            Op::Add | Op::Sub | Op::Mul => {
                let b = self.pop()?;
                let a = self.pop()?;
                let int = match (a, b) {
                    (Value::Int(x), Value::Int(y)) => match op {
                        Op::Add => x.checked_add(y),
                        Op::Sub => x.checked_sub(y),
                        _ => x.checked_mul(y),
                    },
                    _ => None,
                };
                let v = match int {
                    Some(i) => Value::Int(i),
                    None => {
                        let (x, y) = (a.real()?, b.real()?);
                        Value::Real(match op {
                            Op::Add => x + y,
                            Op::Sub => x - y,
                            _ => x * y,
                        })
                    }
                };
                self.push(v)
            }
            Op::Div => {
                let b = self.pop_real()?;
                let a = self.pop_real()?;
                // Division by zero gives 0 (as pdf.js does) rather than
                // failing the program.
                self.push(Value::Real(if b == 0.0 { 0.0 } else { a / b }))
            }
            Op::Idiv | Op::Mod => {
                let b = self.pop_int()?;
                let a = self.pop_int()?;
                let v = if op == Op::Idiv {
                    a.checked_div(b)
                } else {
                    a.checked_rem(b)
                };
                self.push(Value::Int(v.unwrap_or(0)))
            }
            Op::Abs | Op::Neg => {
                let v = match self.pop()? {
                    Value::Int(i) => {
                        let r = if op == Op::Abs {
                            i.checked_abs()
                        } else {
                            i.checked_neg()
                        };
                        r.map_or(Value::Real(-(i as f64)), Value::Int)
                    }
                    Value::Real(r) => Value::Real(if op == Op::Abs { r.abs() } else { -r }),
                    Value::Bool(_) => return None,
                };
                self.push(v)
            }
            Op::Ceiling | Op::Floor | Op::Round | Op::Truncate => {
                let v = match self.pop()? {
                    Value::Int(i) => Value::Int(i),
                    Value::Real(r) => Value::Real(match op {
                        Op::Ceiling => r.ceil(),
                        Op::Floor => r.floor(),
                        // Halves round up.
                        Op::Round => (r + 0.5).floor(),
                        _ => r.trunc(),
                    }),
                    Value::Bool(_) => return None,
                };
                self.push(v)
            }
            Op::Cvi => {
                let i = self.pop()?.int()?;
                self.push(Value::Int(i))
            }
            Op::Cvr => {
                let r = self.pop_real()?;
                self.push(Value::Real(r))
            }
            Op::Sqrt | Op::Ln | Op::Log | Op::Sin | Op::Cos => {
                let x = self.pop_real()?;
                self.push(Value::Real(match op {
                    Op::Sqrt => x.sqrt(),
                    Op::Ln => x.ln(),
                    Op::Log => x.log10(),
                    Op::Sin => x.to_radians().sin(),
                    _ => x.to_radians().cos(),
                }))
            }
            Op::Exp => {
                let e = self.pop_real()?;
                let base = self.pop_real()?;
                self.push(Value::Real(base.powf(e)))
            }
            Op::Atan => {
                let den = self.pop_real()?;
                let num = self.pop_real()?;
                let mut angle = num.atan2(den).to_degrees();
                if angle < 0.0 {
                    angle += 360.0;
                }
                self.push(Value::Real(if angle.is_nan() { 0.0 } else { angle }))
            }
            Op::And | Op::Or | Op::Xor => {
                let b = self.pop()?;
                let a = self.pop()?;
                let v = match (a, b) {
                    (Value::Bool(x), Value::Bool(y)) => Value::Bool(match op {
                        Op::And => x && y,
                        Op::Or => x || y,
                        _ => x != y,
                    }),
                    _ => {
                        let (x, y) = (a.int()?, b.int()?);
                        Value::Int(match op {
                            Op::And => x & y,
                            Op::Or => x | y,
                            _ => x ^ y,
                        })
                    }
                };
                self.push(v)
            }
            Op::Not => {
                let v = match self.pop()? {
                    Value::Bool(b) => Value::Bool(!b),
                    v => Value::Int(!v.int()?),
                };
                self.push(v)
            }
            Op::Bitshift => {
                let shift = self.pop_int()?;
                let v = self.pop_int()? as i32;
                let r = if shift >= 32 || shift <= -32 {
                    0
                } else if shift >= 0 {
                    v.wrapping_shl(shift as u32)
                } else {
                    ((v as u32) >> (-shift) as u32) as i32
                };
                self.push(Value::Int(i64::from(r)))
            }
            Op::Eq | Op::Ne => {
                let b = self.pop()?;
                let a = self.pop()?;
                let same = match (a, b) {
                    (Value::Bool(x), Value::Bool(y)) => x == y,
                    (Value::Bool(_), _) | (_, Value::Bool(_)) => false,
                    _ => a.real() == b.real(),
                };
                self.push(Value::Bool(if op == Op::Eq { same } else { !same }))
            }
            Op::Ge | Op::Gt | Op::Le | Op::Lt => {
                let b = self.pop_real()?;
                let a = self.pop_real()?;
                self.push(Value::Bool(match op {
                    Op::Ge => a >= b,
                    Op::Gt => a > b,
                    Op::Le => a <= b,
                    _ => a < b,
                }))
            }
            Op::Dup => {
                let v = *self.items.get(self.len.checked_sub(1)?)?;
                self.push(v)
            }
            Op::Exch => {
                let b = self.pop()?;
                let a = self.pop()?;
                self.push(b)?;
                self.push(a)
            }
            Op::Pop => self.pop().map(|_| ()),
            Op::Copy => {
                let n = usize::try_from(self.pop_int()?).ok()?;
                let from = self.len.checked_sub(n)?;
                if self.len + n > STACK {
                    return None;
                }
                self.items.copy_within(from..self.len, self.len);
                self.len += n;
                Some(())
            }
            Op::Index => {
                let n = usize::try_from(self.pop_int()?).ok()?;
                let at = self.len.checked_sub(n.checked_add(1)?)?;
                let v = self.items[at];
                self.push(v)
            }
            Op::Roll => {
                let j = self.pop_int()?;
                let n = usize::try_from(self.pop_int()?).ok()?;
                let from = self.len.checked_sub(n)?;
                if n > 0 {
                    let shift = j.rem_euclid(n as i64) as usize;
                    self.items[from..self.len].rotate_right(shift);
                }
                Some(())
            }
        }
    }
}

/// A token of program text.
enum Token<'a> {
    Open,
    Close,
    Number(Value),
    Word(&'a [u8]),
}

struct Lexer<'a> {
    src: &'a [u8],
    at: usize,
}

fn is_space(b: u8) -> bool {
    matches!(b, b'\0' | b'\t' | b'\n' | b'\x0c' | b'\r' | b' ')
}

fn is_delimiter(b: u8) -> bool {
    matches!(
        b,
        b'{' | b'}' | b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'/' | b'%'
    )
}

impl<'a> Lexer<'a> {
    fn next(&mut self) -> Option<Token<'a>> {
        loop {
            let b = *self.src.get(self.at)?;
            if is_space(b) {
                self.at += 1;
            } else if b == b'%' {
                while self
                    .src
                    .get(self.at)
                    .is_some_and(|&c| c != b'\n' && c != b'\r')
                {
                    self.at += 1;
                }
            } else {
                break;
            }
        }
        let b = self.src[self.at];
        if b == b'{' || b == b'}' {
            self.at += 1;
            return Some(if b == b'{' { Token::Open } else { Token::Close });
        }
        let start = self.at;
        self.at += 1;
        while self
            .src
            .get(self.at)
            .is_some_and(|&c| !is_space(c) && !is_delimiter(c))
        {
            self.at += 1;
        }
        let word = &self.src[start..self.at];
        Some(match parse_number(word) {
            Some(v) => Token::Number(v),
            None => Token::Word(word),
        })
    }
}

/// An integer, real, or radix (`16#FF`) number.
fn parse_number(word: &[u8]) -> Option<Value> {
    let text = std::str::from_utf8(word).ok()?;
    let first = *word.first()?;
    if !(first.is_ascii_digit() || matches!(first, b'+' | b'-' | b'.')) {
        return None;
    }
    if let Ok(i) = text.parse::<i64>() {
        return Some(Value::Int(i));
    }
    if let Some((radix, digits)) = text.split_once('#') {
        let radix = radix.parse::<u32>().ok().filter(|r| (2..=36).contains(r))?;
        return i64::from_str_radix(digits, radix).ok().map(Value::Int);
    }
    text.parse::<f64>()
        .ok()
        .filter(|r| r.is_finite())
        .map(Value::Real)
}
