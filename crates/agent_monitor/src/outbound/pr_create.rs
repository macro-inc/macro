//! Whether a shell command runs `gh pr create`, for the transcript parsers
//! that credit a session with the pull request it opened.
//!
//! Only a command that starts a pipeline element counts: the start of the
//! text, or after `;`, `&`, `|`, a newline, `(`, `$(` or a backtick, past any
//! `NAME=value` assignments and an `env` or `command` prefix; a `$(...)`
//! inside double quotes counts too. Otherwise the words of quoted strings,
//! heredoc bodies and comments never start a command, so `grep "gh pr
//! create"`, `echo gh pr create` and a heredoc that mentions it do not count.

#[cfg(test)]
mod test;

/// The words that open a pull request.
const PR_CREATE: [&str; 3] = ["gh", "pr", "create"];

/// Prefixes that run the rest of the words as the command.
const WRAPPERS: &[&str] = &["env", "command"];

/// Whether `command` (shell text) runs `gh pr create`.
pub(crate) fn invokes_pr_create(command: &str) -> bool {
    // Cheap reject before scanning.
    if !command.contains("create") {
        return false;
    }
    let mut scanner = Scanner::default();
    let chars: Vec<char> = command.chars().collect();
    let mut index = 0;
    while let Some(&char) = chars.get(index) {
        index += 1;
        match char {
            '\'' => {
                scanner.quoted = true;
                while let Some(&char) = chars.get(index) {
                    index += 1;
                    if char == '\'' {
                        break;
                    }
                    scanner.word.push(char);
                }
            }
            '"' => {
                scanner.quoted = true;
                while let Some(&char) = chars.get(index) {
                    index += 1;
                    match char {
                        '"' => break,
                        // A command substitution inside the quotes is a
                        // command of its own.
                        '$' if chars.get(index) == Some(&'(') => {
                            let start = index + 1;
                            index = matching_paren(&chars, start);
                            let inner: String =
                                chars.get(start..index).unwrap_or_default().iter().collect();
                            scanner.found |= invokes_pr_create(&inner);
                            index = (index + 1).min(chars.len());
                        }
                        '\\' => {
                            if let Some(&next) = chars.get(index) {
                                index += 1;
                                scanner.word.push(next);
                            }
                        }
                        _ => scanner.word.push(char),
                    }
                }
            }
            '\\' => match chars.get(index) {
                Some('\n') => index += 1,
                Some(&next) => {
                    index += 1;
                    scanner.word.push(next);
                }
                None => {}
            },
            '#' if scanner.word.is_empty() && !scanner.quoted => {
                while chars.get(index).is_some_and(|&char| char != '\n') {
                    index += 1;
                }
            }
            '\n' => {
                scanner.end_command();
                index = scanner.skip_heredocs(&chars, index);
            }
            ';' | '&' | '|' | '(' | ')' | '`' => scanner.end_command(),
            '$' if chars.get(index) == Some(&'(') => {
                index += 1;
                scanner.end_command();
            }
            '<' if chars.get(index) == Some(&'<') => {
                scanner.end_word();
                index += 1;
                if chars.get(index) == Some(&'<') {
                    // A here-string: its word is an argument.
                    index += 1;
                    continue;
                }
                let strip_tabs = chars.get(index) == Some(&'-');
                if strip_tabs {
                    index += 1;
                }
                while chars
                    .get(index)
                    .is_some_and(|char| *char == ' ' || *char == '\t')
                {
                    index += 1;
                }
                let mut delimiter = String::new();
                while let Some(&char) = chars.get(index) {
                    if char.is_whitespace() || matches!(char, ';' | '&' | '|' | '<' | '>' | ')') {
                        break;
                    }
                    index += 1;
                    if !matches!(char, '\'' | '"' | '\\') {
                        delimiter.push(char);
                    }
                }
                if !delimiter.is_empty() {
                    scanner.heredocs.push((delimiter, strip_tabs));
                }
            }
            char if char.is_whitespace() => scanner.end_word(),
            char => scanner.word.push(char),
        }
        if scanner.found {
            return true;
        }
    }
    scanner.end_command();
    scanner.found
}

#[derive(Default)]
struct Scanner {
    /// The current command's words so far.
    words: Vec<String>,
    /// The word being read.
    word: String,
    /// The word being read has a quoted part (so it is a word even if empty).
    quoted: bool,
    /// Heredocs opened on the current line: their delimiter, and whether
    /// leading tabs are stripped (`<<-`).
    heredocs: Vec<(String, bool)>,
    found: bool,
}

impl Scanner {
    fn end_word(&mut self) {
        if !self.word.is_empty() || self.quoted {
            self.words.push(std::mem::take(&mut self.word));
        }
        self.quoted = false;
    }

    fn end_command(&mut self) {
        self.end_word();
        let mut words = self
            .words
            .iter()
            .map(String::as_str)
            .skip_while(|word| is_assignment(word))
            .peekable();
        while words.next_if(|word| WRAPPERS.contains(word)).is_some() {}
        let program: Vec<&str> = words.take(PR_CREATE.len()).collect();
        let runs = program.len() == PR_CREATE.len()
            && program.first().is_some_and(|word| {
                *word == PR_CREATE[0] || word.ends_with(&format!("/{}", PR_CREATE[0]))
            })
            && program[1..] == PR_CREATE[1..];
        self.found |= runs;
        self.words.clear();
    }

    /// Skips the bodies of the heredocs opened on the line that just ended,
    /// from `index` (the start of the next line); returns where reading goes on.
    fn skip_heredocs(&mut self, chars: &[char], mut index: usize) -> usize {
        for (delimiter, strip_tabs) in std::mem::take(&mut self.heredocs) {
            while index < chars.len() {
                let end = chars[index..]
                    .iter()
                    .position(|&char| char == '\n')
                    .map_or(chars.len(), |offset| index + offset);
                let line: String = chars[index..end].iter().collect();
                index = (end + 1).min(chars.len());
                let line = if strip_tabs {
                    line.trim_start_matches('\t')
                } else {
                    &line
                };
                if line == delimiter {
                    break;
                }
            }
        }
        index
    }
}

/// Where the `)` closing a substitution that starts at `start` is (or the
/// end of the text when it is never closed).
fn matching_paren(chars: &[char], start: usize) -> usize {
    let mut depth = 0_usize;
    for (offset, char) in chars.iter().enumerate().skip(start) {
        match char {
            '(' => depth += 1,
            ')' if depth == 0 => return offset,
            ')' => depth -= 1,
            _ => {}
        }
    }
    chars.len()
}

/// `NAME=value`, a variable assignment before a command.
fn is_assignment(word: &str) -> bool {
    word.split_once('=').is_some_and(|(name, _)| {
        !name.is_empty()
            && name
                .chars()
                .all(|char| char.is_ascii_alphanumeric() || char == '_')
            && !name.starts_with(|char: char| char.is_ascii_digit())
    })
}
