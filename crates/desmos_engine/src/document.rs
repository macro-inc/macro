//! Stored graph: expressions, sliders, viewport, Desmos color cycle.

use crate::error::{DesmosError, Result};
use crate::eval::Env;
use crate::expr::{Expr, Statement, is_reserved};
use crate::parse::parse_statement;
use serde::{Deserialize, Serialize};

/// Default Desmos palette, cycled for new expressions.
pub const COLORS: [&str; 6] = [
    "#c74440", "#2d70b3", "#388c46", "#6042a6", "#fa7e19", "#000000",
];

/// Visible window in graph units.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Viewport {
    /// Left edge.
    pub xmin: f64,
    /// Right edge.
    pub xmax: f64,
    /// Bottom edge.
    pub ymin: f64,
    /// Top edge.
    pub ymax: f64,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            xmin: -10.0,
            xmax: 10.0,
            ymin: -10.0,
            ymax: 10.0,
        }
    }
}

/// Slider bounds for a parameter assignment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Slider {
    /// Lower bound.
    pub min: f64,
    /// Upper bound.
    pub max: f64,
    /// Optional step. Continuous when absent.
    pub step: Option<f64>,
}

impl Default for Slider {
    fn default() -> Self {
        Self {
            min: -10.0,
            max: 10.0,
            step: None,
        }
    }
}

/// One expression-list row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Expression {
    /// Stable row id.
    pub id: String,
    /// Source text, Desmos-style.
    pub latex: String,
    /// Stroke / fill color.
    pub color: String,
    /// Hidden rows are not plotted.
    #[serde(default)]
    pub hidden: bool,
    /// Slider chrome, when this row is a parameter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slider: Option<Slider>,
}

impl Expression {
    /// A new empty row with the next palette color.
    pub fn blank(id: String, index: usize) -> Self {
        Self {
            id,
            latex: String::new(),
            color: COLORS[index % COLORS.len()].into(),
            hidden: false,
            slider: None,
        }
    }
}

/// Versioned `.desmos` document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphDocument {
    /// Format version.
    pub version: u32,
    /// Graph window.
    pub viewport: Viewport,
    /// Expression list, top to bottom.
    pub expressions: Vec<Expression>,
}

impl Default for GraphDocument {
    fn default() -> Self {
        Self {
            version: 1,
            viewport: Viewport::default(),
            expressions: vec![Expression::blank("1".into(), 0)],
        }
    }
}

impl GraphDocument {
    /// Parse stored JSON.
    pub fn from_json(source: &str) -> Result<Self> {
        if source.trim().is_empty() {
            return Ok(Self::default());
        }
        let doc: Self =
            serde_json::from_str(source).map_err(|e| DesmosError::Document(e.to_string()))?;
        if doc.version != 1 {
            return Err(DesmosError::Document(format!(
                "unsupported version {}",
                doc.version
            )));
        }
        Ok(doc)
    }

    /// Serialize to JSON.
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string(self).map_err(|e| DesmosError::Document(e.to_string()))
    }

    /// Next unused numeric id.
    pub fn next_id(&self) -> String {
        let max = self
            .expressions
            .iter()
            .filter_map(|e| e.id.parse::<u32>().ok())
            .max()
            .unwrap_or(0);
        (max + 1).to_string()
    }

    /// Append an empty expression and return its id.
    pub fn add_expression(&mut self) -> String {
        let id = self.next_id();
        let index = self.expressions.len();
        self.expressions.push(Expression::blank(id.clone(), index));
        id
    }

    /// Replace one row's source. Empty source is allowed.
    pub fn set_latex(&mut self, id: &str, latex: String) -> Result<()> {
        let expr = self
            .expressions
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| DesmosError::Document(format!("unknown expression {id}")))?;
        expr.latex = latex;
        if let Ok(Statement::Assignment { .. }) = parse_statement(&expr.latex)
            && expr.slider.is_none()
        {
            expr.slider = Some(Slider::default());
        }
        Ok(())
    }

    /// Set a row's stroke color.
    pub fn set_color(&mut self, id: &str, color: String) -> Result<()> {
        let expr = self
            .expressions
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| DesmosError::Document(format!("unknown expression {id}")))?;
        expr.color = color;
        Ok(())
    }

    /// Set a slider value by rewriting `name = value`.
    pub fn set_slider(&mut self, id: &str, value: f64) -> Result<()> {
        let expr = self
            .expressions
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| DesmosError::Document(format!("unknown expression {id}")))?;
        let Statement::Assignment { name, .. } = parse_statement(&expr.latex)
            .map_err(|_| DesmosError::Document("not a slider".into()))?
        else {
            return Err(DesmosError::Document("not a slider".into()));
        };
        if let Some(slider) = &expr.slider {
            let stepped = match slider.step {
                Some(step) if step > 0.0 => {
                    let n = ((value - slider.min) / step).round();
                    slider.min + n * step
                }
                _ => value,
            };
            expr.latex = format!(
                "{name}={}",
                trim_number(stepped.clamp(slider.min, slider.max))
            );
        } else {
            expr.latex = format!("{name}={}", trim_number(value));
        }
        Ok(())
    }

    /// Bind assignments and functions for plotting.
    pub fn env(&self) -> Env {
        let mut env = Env::default();
        for expr in &self.expressions {
            if expr.latex.trim().is_empty() {
                continue;
            }
            match parse_statement(&expr.latex) {
                Ok(Statement::Assignment { name, value }) => {
                    if let Ok(n) = env.eval(&value) {
                        env.set(name, n);
                    }
                }
                Ok(Statement::Function { name, params, body }) => {
                    env.fns.insert(name, (params, body));
                }
                _ => {}
            }
        }
        env
    }

    /// Free parameters that should grow sliders, Desmos-style.
    pub fn needed_sliders(&self) -> Vec<String> {
        let mut defined = Vec::new();
        let mut used = Vec::new();
        for expr in &self.expressions {
            if expr.latex.trim().is_empty() {
                continue;
            }
            match parse_statement(&expr.latex) {
                Ok(Statement::Assignment { name, .. }) => defined.push(name),
                Ok(Statement::Function { name, params, body }) => {
                    defined.push(name);
                    for name in body.names() {
                        if !params.contains(&name) && !is_reserved(&name) {
                            used.push(name);
                        }
                    }
                }
                Ok(Statement::Relation {
                    left,
                    right,
                    restrict,
                    ..
                }) => {
                    let parametric = left.is_none()
                        && matches!(&right, Expr::Point(x, y) if x.uses("t") || y.uses("t"));
                    if let Some(left) = left {
                        used.extend(left.names());
                    }
                    used.extend(
                        right
                            .names()
                            .into_iter()
                            .filter(|n| !(parametric && n == "t")),
                    );
                    for restriction in restrict {
                        used.extend(restriction.left.names());
                        used.extend(restriction.right.names());
                    }
                }
                Err(_) => {}
            }
        }
        used.sort();
        used.dedup();
        used.into_iter()
            .filter(|n| !is_reserved(n) && !defined.contains(n))
            .collect()
    }
}

fn trim_number(value: f64) -> String {
    let text = format!("{value:.6}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() || text == "-" {
        "0".into()
    } else {
        text.into()
    }
}

#[cfg(test)]
mod test;
