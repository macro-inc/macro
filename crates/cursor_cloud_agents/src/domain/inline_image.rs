//! Drops the `<img>` tags Cursor streams for its walkthrough artifacts.
//!
//! Cursor's walkthrough skill tells the agent to reference screenshots with
//! HTML tags inline, and Macro tells it to use the bare file name, so a turn
//! that took a screenshot streams `<img src="shot.png" />` in its prose. That
//! file lives in Cursor's sandbox: no reader can resolve the tag, and the
//! transcript renders it as literal text. The image itself reaches the reader
//! anyway, as the markdown [`super::artifact::artifact_markdown`] appends once
//! the run's artifacts are re-hosted, so the tag is dropped here.
//!
//! The tag arrives a token at a time (`<img`, ` src`, `="`, `shot`, …), so a
//! per-chunk match cannot see it. Text is held from a `<` while it can still
//! become `<img`, then until the tag closes; anything that turns out to be
//! prose is released unchanged.

const TAG: &str = "<img";

/// One run's view of its streamed text, tags withheld.
#[derive(Debug, Default)]
pub struct InlineImageFilter {
    held: String,
}

impl InlineImageFilter {
    /// The part of `text` to show, given what earlier chunks left held back.
    pub fn push(&mut self, text: &str) -> String {
        let mut shown = String::new();
        for ch in text.chars() {
            if self.held.is_empty() {
                if ch == '<' {
                    self.held.push(ch);
                } else {
                    shown.push(ch);
                }
                continue;
            }
            self.held.push(ch);
            match self.classify() {
                Held::Prose => shown.push_str(&self.flush()),
                Held::Pending => {}
                Held::Tag if ch == '>' => {
                    let tag = self.flush();
                    if keeps(&tag) {
                        shown.push_str(&tag);
                    }
                }
                Held::Tag => {}
            }
        }
        shown
    }

    /// Whatever is still held, for when the stream ends mid-tag.
    pub fn flush(&mut self) -> String {
        std::mem::take(&mut self.held)
    }

    fn classify(&self) -> Held {
        let held = self.held.as_str();
        if held.len() < TAG.len() {
            return if TAG.starts_with(held) {
                Held::Pending
            } else {
                Held::Prose
            };
        }
        let Some(name) = held.get(..TAG.len()) else {
            return Held::Prose;
        };
        if !name.eq_ignore_ascii_case(TAG) {
            return Held::Prose;
        }
        // `<imgs` or `<image` is a word, not this tag.
        match held[TAG.len()..].chars().next() {
            None => Held::Pending,
            Some(next) if next.is_whitespace() || next == '/' || next == '>' => Held::Tag,
            Some(_) => Held::Prose,
        }
    }
}

enum Held {
    /// Could still become `<img`.
    Pending,
    /// Is an `<img` tag, open until `>`.
    Tag,
    /// Ordinary text, shown as it was.
    Prose,
}

/// A tag pointing at something a reader can reach is not the sandbox
/// reference this filter exists for, and is left alone.
fn keeps(tag: &str) -> bool {
    src(tag).is_some_and(|src| src.contains("://"))
}

fn src(tag: &str) -> Option<&str> {
    let after = &tag[tag.find("src")? + "src".len()..];
    let after = after.trim_start().strip_prefix('=')?.trim_start();
    let quote = after.chars().next().filter(|c| matches!(c, '"' | '\''))?;
    let value = &after[quote.len_utf8()..];
    value.split(quote).next()
}

#[cfg(test)]
mod test {
    use super::*;

    fn stream(chunks: &[&str]) -> String {
        let mut filter = InlineImageFilter::default();
        let mut shown: String = chunks.iter().map(|chunk| filter.push(chunk)).collect();
        shown.push_str(&filter.flush());
        shown
    }

    /// The delta sequence of dev session 01a0b4ed-29e1-7634-9a67-b87aa0d3efe8.
    #[test]
    fn a_tag_split_across_deltas_is_dropped() {
        let deltas = [
            "Here",
            " is",
            " the",
            " screenshot",
            ":\n\n",
            "<img",
            " src",
            "=\"",
            "hello",
            "_",
            "world",
            "_",
            "browser",
            ".png",
            "\"",
            " alt",
            "=\"",
            "Hello",
            " World",
            " HTML",
            " page",
            " in",
            " Chrome",
            "\"",
            " />",
            "\n\n",
            "Open",
            " `",
            "index",
            ".html",
            "`",
        ];
        assert_eq!(
            stream(&deltas),
            "Here is the screenshot:\n\n\n\nOpen `index.html`"
        );
    }

    #[test]
    fn a_sandbox_path_is_dropped_too() {
        assert_eq!(
            stream(&["Proof:\n<img src=\"/opt/cursor/artifacts/pr.webp\" />\nDone."]),
            "Proof:\n\nDone."
        );
    }

    #[test]
    fn a_hosted_image_is_shown() {
        let tag = "<img alt=\"CI\" src=\"https://github.com/macro-inc/macro/actions/workflows/ci.yml/badge.svg\">";
        assert_eq!(stream(&["Status: ", tag]), format!("Status: {tag}"));
    }

    #[test]
    fn prose_with_angle_brackets_is_untouched() {
        for text in [
            "a < b and b > c",
            "use <image> here",
            "<imgs are plural",
            "generics like Vec<T>",
            "an unfinished < at the end",
            "<i>emphasis</i>",
        ] {
            assert_eq!(stream(&[text]), text);
            let chars: Vec<String> = text.chars().map(String::from).collect();
            let refs: Vec<&str> = chars.iter().map(String::as_str).collect();
            assert_eq!(stream(&refs), text, "one char per delta");
        }
    }

    #[test]
    fn an_unterminated_tag_is_released_on_flush() {
        let mut filter = InlineImageFilter::default();
        assert_eq!(filter.push("Shipped.\n<img src=\"proof"), "Shipped.\n");
        assert_eq!(filter.flush(), "<img src=\"proof");
    }
}
