use std::collections::HashMap;

#[derive(Debug, Default)]
struct TrieNode {
    children: HashMap<char, TrieNode>,
    is_terminal: bool,
}

#[derive(Debug, Default)]
pub struct ReversedSuffixTrie {
    root: TrieNode,
}

impl ReversedSuffixTrie {
    pub fn new() -> Self {
        Self {
            root: TrieNode::default(),
        }
    }

    pub fn insert(&mut self, suffix: &str) {
        let mut node = &mut self.root;
        for ch in suffix.chars().rev() {
            node = node.children.entry(ch).or_default();
        }
        node.is_terminal = true;
    }

    // doesn't need to check for longest suffix, only that any suffix exists
    pub fn string_has_suffix(&self, filename: &str) -> bool {
        let mut node = &self.root;

        for ch in filename.chars().rev() {
            match node.children.get(&ch) {
                Some(next_node) => {
                    node = next_node;
                    if node.is_terminal {
                        return true;
                    }
                }
                None => break,
            }
        }

        false
    }

    /// Return the longest matching suffix from the trie (if any)
    pub fn longest_suffix<'a>(&self, filename: &'a str) -> Option<&'a str> {
        let mut node = &self.root;
        let mut last_match_index = None;

        for (i, ch) in filename.chars().rev().enumerate() {
            if let Some(next_node) = node.children.get(&ch) {
                node = next_node;
                if node.is_terminal {
                    last_match_index = Some(i);
                }
            } else {
                break;
            }
        }

        last_match_index.map(|i| {
            let suffix_len = i + 1;
            &filename[filename.len() - suffix_len..]
        })
    }

    // NOTE: will discard the period in the extension
    pub fn split_suffix<'a>(&self, filename: &'a str) -> Option<(&'a str, &'a str)> {
        self.longest_suffix(filename).map(|suffix| {
            let split_index = filename.len() - suffix.len();
            (&filename[..split_index], &filename[split_index + 1..])
        })
    }
}
