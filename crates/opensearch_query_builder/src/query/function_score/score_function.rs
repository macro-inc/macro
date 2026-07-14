use serde::Serialize;
use serde_json::{Map, Value};

use crate::{
    DecayFunction, FieldValueFactor, QueryType, RandomScore, ScriptScore, ToOpenSearchJson,
};

/// Enum representing different scoring functions
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ScoreFunctionType<'a> {
    /// Gauss decay function
    Gauss(DecayFunction<'a>),
    /// Exp decay function
    Exp(DecayFunction<'a>),
    /// Linear decay function
    Linear(DecayFunction<'a>),
    /// Field value factor function
    FieldValueFactor(FieldValueFactor<'a>),
    /// Random score function
    RandomScore(RandomScore<'a>),
    /// Script score function
    ScriptScore(ScriptScore<'a>),
    /// Weight function
    Weight(f64),
}

impl<'a> ScoreFunctionType<'a> {
    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> ScoreFunctionType<'static> {
        match self {
            ScoreFunctionType::Gauss(decay) => ScoreFunctionType::Gauss(decay.to_owned()),
            ScoreFunctionType::Exp(decay) => ScoreFunctionType::Exp(decay.to_owned()),
            ScoreFunctionType::Linear(decay) => ScoreFunctionType::Linear(decay.to_owned()),
            ScoreFunctionType::FieldValueFactor(fvf) => {
                ScoreFunctionType::FieldValueFactor(fvf.to_owned())
            }
            ScoreFunctionType::RandomScore(rs) => ScoreFunctionType::RandomScore(rs.to_owned()),
            ScoreFunctionType::ScriptScore(ss) => ScoreFunctionType::ScriptScore(ss.to_owned()),
            ScoreFunctionType::Weight(w) => ScoreFunctionType::Weight(*w),
        }
    }
}

/// A single scoring function with optional filter and weight
#[derive(Debug, Clone, Serialize)]
pub struct ScoreFunction<'a> {
    /// The scoring function
    #[serde(flatten)]
    pub function: ScoreFunctionType<'a>,
    /// The filter to apply to the function
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<Box<QueryType<'a>>>,
    /// The weight to apply to the function
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<f64>,
}

impl<'a> ScoreFunction<'a> {
    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> ScoreFunction<'static> {
        ScoreFunction {
            function: self.function.to_owned(),
            filter: self.filter.as_ref().map(|f| Box::new((**f).to_owned())),
            weight: self.weight,
        }
    }
}

impl<'a> ToOpenSearchJson for ScoreFunction<'a> {
    fn to_json(&self) -> Value {
        let mut result = Map::new();

        // Add the function type
        match &self.function {
            ScoreFunctionType::Gauss(decay) => {
                let mut decay_obj = Map::new();
                let mut field_obj = Map::new();

                if let Some(ref origin) = decay.origin {
                    field_obj.insert("origin".to_string(), origin.clone());
                }
                field_obj.insert("scale".to_string(), Value::String(decay.scale.to_string()));
                if let Some(ref offset) = decay.offset {
                    field_obj.insert("offset".to_string(), Value::String(offset.to_string()));
                }
                if let Some(decay_val) = decay.decay {
                    field_obj.insert("decay".to_string(), decay_val.into());
                }

                decay_obj.insert(decay.field.to_string(), Value::Object(field_obj));
                result.insert("gauss".to_string(), Value::Object(decay_obj));
            }
            ScoreFunctionType::Exp(decay) => {
                let mut decay_obj = Map::new();
                let mut field_obj = Map::new();

                if let Some(ref origin) = decay.origin {
                    field_obj.insert("origin".to_string(), origin.clone());
                }
                field_obj.insert("scale".to_string(), Value::String(decay.scale.to_string()));
                if let Some(ref offset) = decay.offset {
                    field_obj.insert("offset".to_string(), Value::String(offset.to_string()));
                }
                if let Some(decay_val) = decay.decay {
                    field_obj.insert("decay".to_string(), decay_val.into());
                }

                decay_obj.insert(decay.field.to_string(), Value::Object(field_obj));
                result.insert("exp".to_string(), Value::Object(decay_obj));
            }
            ScoreFunctionType::Linear(decay) => {
                let mut decay_obj = Map::new();
                let mut field_obj = Map::new();

                if let Some(ref origin) = decay.origin {
                    field_obj.insert("origin".to_string(), origin.clone());
                }
                field_obj.insert("scale".to_string(), Value::String(decay.scale.to_string()));
                if let Some(ref offset) = decay.offset {
                    field_obj.insert("offset".to_string(), Value::String(offset.to_string()));
                }
                if let Some(decay_val) = decay.decay {
                    field_obj.insert("decay".to_string(), decay_val.into());
                }

                decay_obj.insert(decay.field.to_string(), Value::Object(field_obj));
                result.insert("linear".to_string(), Value::Object(decay_obj));
            }
            ScoreFunctionType::FieldValueFactor(fvf) => {
                let mut fvf_obj = Map::new();
                fvf_obj.insert("field".to_string(), Value::String(fvf.field.to_string()));
                if let Some(factor) = fvf.factor {
                    fvf_obj.insert("factor".to_string(), factor.into());
                }
                if let Some(ref modifier) = fvf.modifier {
                    fvf_obj.insert("modifier".to_string(), Value::String(modifier.to_string()));
                }
                if let Some(missing) = fvf.missing {
                    fvf_obj.insert("missing".to_string(), missing.into());
                }
                result.insert("field_value_factor".to_string(), Value::Object(fvf_obj));
            }
            ScoreFunctionType::RandomScore(rs) => {
                let mut rs_obj = Map::new();
                if let Some(ref seed) = rs.seed {
                    rs_obj.insert("seed".to_string(), seed.clone());
                }
                if let Some(ref field) = rs.field {
                    rs_obj.insert("field".to_string(), Value::String(field.to_string()));
                }
                result.insert("random_score".to_string(), Value::Object(rs_obj));
            }
            ScoreFunctionType::ScriptScore(ss) => {
                let mut script_obj = Map::new();
                script_obj.insert("source".to_string(), Value::String(ss.source.to_string()));
                if let Some(ref params) = ss.params {
                    script_obj.insert("params".to_string(), Value::Object(params.clone()));
                }
                let mut ss_obj = Map::new();
                ss_obj.insert("script".to_string(), Value::Object(script_obj));
                result.insert("script_score".to_string(), Value::Object(ss_obj));
            }
            ScoreFunctionType::Weight(_) => {
                // Weight-only functions don't add a function type field
            }
        }

        // Add filter if present
        if let Some(ref filter) = self.filter {
            result.insert("filter".to_string(), filter.to_json());
        }

        // Add weight if present
        if let Some(weight) = self.weight {
            result.insert("weight".to_string(), weight.into());
        }

        Value::Object(result)
    }
}
