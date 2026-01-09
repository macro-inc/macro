use std::fmt::Display;

pub struct InsightContextLog<T: Display> {
    pub name: String,
    pub metadata: Vec<(String, String)>,
    pub content: T,
}

impl<T> Display for InsightContextLog<T>
where
    T: Display + Sized,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let metadata = self
            .metadata
            .iter()
            .map(|(k, v)| format!("{}: {}", k, v))
            .collect::<Vec<_>>()
            .join(", ");
        writeln!(f, "[{}]", self.name)?;
        if !metadata.is_empty() {
            writeln!(f, "{}", metadata)?;
        }
        writeln!(f, "{}", self.content)?;
        writeln!(f, "[END {}]", self.name)
    }
}
