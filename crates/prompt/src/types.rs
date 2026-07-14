use std::borrow::Cow;
use std::fmt::Display;

/// A prompt passed to AI
pub struct StaticPrompt<'a> {
    /// Instructions passed to model in request
    pub instructions: Cow<'a, str>,
    /// Intent of the request used for testing
    pub intent: Cow<'a, str>,
    /// A title to deliminate the prompt in composition
    pub title: Cow<'a, str>,
}

impl<'a> StaticPrompt<'a> {
    /// Build a prompt from borrowed strings. `const` so modules can declare
    /// a `pub static` `StaticPrompt<'static>` built entirely at compile time.
    pub const fn borrowed(title: &'a str, instructions: &'a str, intent: &'a str) -> Self {
        Self {
            instructions: Cow::Borrowed(instructions),
            intent: Cow::Borrowed(intent),
            title: Cow::Borrowed(title),
        }
    }
}

impl StaticPrompt<'static> {
    /// Chain another section after this prompt, starting a [`ComposedPrompt`].
    pub const fn compose(&'static self, next: Section) -> ComposedPrompt {
        ComposedPrompt {
            left: self,
            right: next,
        }
    }
}

impl<'a> Display for StaticPrompt<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "# {}\n{}", self.title, self.instructions)
    }
}

/// A prompt section that can take part in a composition: any `'static`
/// renderable value, e.g. a `StaticPrompt` or another [`ComposedPrompt`].
pub type Section = &'static (dyn Display + Sync);

/// Prompt sections chained together, rendered in composition order via
/// [`Display`]. Built by calling `compose` on a [`StaticPrompt`] and chaining
/// further `compose` calls; inside a `static` initializer the intermediate
/// compositions get `'static` lifetime, so the whole chain is built at
/// compile time.
pub struct ComposedPrompt {
    left: Section,
    right: Section,
}

impl ComposedPrompt {
    /// Chain another section after this composition.
    pub const fn compose(&'static self, next: Section) -> ComposedPrompt {
        ComposedPrompt {
            left: self,
            right: next,
        }
    }
}

impl Display for ComposedPrompt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        Display::fmt(self.left, f)?;
        Display::fmt(self.right, f)
    }
}
