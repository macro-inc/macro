use serde::Deserialize;

pub trait Metadata: for<'de> Deserialize<'de> {
    fn name() -> String;
    fn description() -> Option<String>;
}

pub trait TextAttachment: std::fmt::Display + std::fmt::Debug + Send + Sync {}

impl TextAttachment for Box<dyn TextAttachment> {}
