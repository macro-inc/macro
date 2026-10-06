//! Bounded agent-authored organization; neither grouping nor maps change access.
use super::*;
use std::collections::{HashMap, HashSet};

#[cfg(test)]
mod test;

pub(super) fn validate_groups(revision: &Revision, groups: Option<&[FileGroup]>) -> Result<()> {
    let groups = groups.unwrap_or_default();
    if groups.len() > 32 || groups.iter().map(|group| group.files.len()).sum::<usize>() > 256 {
        return Err(ReviewError::Invalid(
            "Too many file groups or patterns".into(),
        ));
    }
    let mut keys = HashSet::new();
    for group in groups {
        validate_text(&group.key, 100)?;
        validate_text(&group.title, 100)?;
        if !keys.insert(&group.key) || group.files.is_empty() {
            return Err(ReviewError::Invalid(
                "File groups need unique keys and matching files".into(),
            ));
        }
        validate_patterns(revision, &group.files)?;
    }
    Ok(())
}

fn validate_patterns(revision: &Revision, patterns: &[String]) -> Result<()> {
    for pattern in patterns {
        validate_text(pattern, 512)?;
        if pattern.matches("**/").count() > 4
            || !revision
                .files
                .iter()
                .any(|file| diffd_core::kinds::matches(pattern, &file.path))
        {
            return Err(ReviewError::Invalid(format!(
                "File pattern does not match this revision: {pattern}"
            )));
        }
    }
    Ok(())
}

impl<S> ReviewService<S> {
    pub(super) async fn validate_graph(
        &self,
        review: &Review,
        graph: Option<&ReviewGraph>,
    ) -> Result<()> {
        let Some(graph) = graph else { return Ok(()) };
        validate_text(&graph.title, 100)?;
        if graph.nodes.len() > 64
            || graph.edges.len() > 128
            || graph
                .nodes
                .iter()
                .map(|node| node.files.len())
                .sum::<usize>()
                > 256
        {
            return Err(ReviewError::Invalid(
                "Component map exceeds its size budget".into(),
            ));
        }
        validate_hierarchy(graph)?;
        let revision = review.revisions.last().ok_or(ReviewError::NotFound)?;
        let number = revision.number;
        let mut ids = HashSet::new();
        for node in &graph.nodes {
            validate_text(&node.id, 100)?;
            validate_text(&node.title, 100)?;
            if let Some(description) = &node.description {
                validate_text(description, 180)?;
            }
            if let Some(kind) = &node.kind {
                validate_text(kind, 32)?;
            }
            validate_patterns(revision, &node.files)?;
            if !ids.insert(&node.id) {
                return Err(ReviewError::Invalid(
                    "Map component IDs must be unique".into(),
                ));
            }
            self.anchor(review, number, node.location.clone()).await?;
        }
        let mut edges = HashSet::new();
        for edge in &graph.edges {
            validate_text(&edge.label, 100)?;
            if !ids.contains(&edge.from)
                || !ids.contains(&edge.to)
                || !edges.insert((&edge.from, &edge.to))
            {
                return Err(ReviewError::Invalid(
                    "Map relationships must connect existing components once".into(),
                ));
            }
            if let Some(at) = &edge.location {
                self.anchor(review, number, at.clone()).await?;
            }
        }
        Ok(())
    }

    pub(super) async fn relocate_graph(
        &self,
        review: &mut Review,
        revision: u32,
        files: &[ReviewFile],
    ) -> Result<()> {
        let Some(mut graph) = review.graph.clone() else {
            return Ok(());
        };
        let parents: HashMap<_, _> = graph
            .nodes
            .iter()
            .map(|node| (node.id.clone(), node.parent.clone()))
            .collect();
        let mut nodes = Vec::new();
        for mut node in graph.nodes {
            if let Some(location) = self
                .relocate_location(review, revision, node.location, files)
                .await?
            {
                node.location = location;
                for member in &mut node.files {
                    // Exact members follow renames; directory/glob selectors
                    // retain their authored meaning in each revision.
                    if !member.contains(['*', '?']) {
                        let path = member.trim().trim_start_matches("./");
                        if let Some(renamed) = files
                            .iter()
                            .find(|file| file.old_path.as_deref() == Some(path))
                        {
                            *member = renamed.path.clone();
                        }
                    }
                }
                nodes.push(node);
            }
        }
        // Preserve surviving detail when an enclosing component's anchor disappears.
        let surviving: HashSet<_> = nodes.iter().map(|node| node.id.clone()).collect();
        for node in &mut nodes {
            while let Some(parent) = &node.parent {
                if surviving.contains(parent) {
                    break;
                }
                node.parent = parents.get(parent).cloned().flatten();
            }
        }
        graph.nodes = nodes;
        let mut edges = Vec::new();
        for mut edge in graph.edges {
            if !graph.nodes.iter().any(|node| node.id == edge.from)
                || !graph.nodes.iter().any(|node| node.id == edge.to)
            {
                continue;
            }
            if let Some(location) = edge.location {
                edge.location = self
                    .relocate_location(review, revision, location, files)
                    .await?;
            }
            edges.push(edge);
        }
        graph.edges = edges;
        review.graph = (!graph.nodes.is_empty()).then_some(graph);
        Ok(())
    }

    async fn relocate_location(
        &self,
        review: &Review,
        revision: u32,
        location: Location,
        files: &[ReviewFile],
    ) -> Result<Option<Location>> {
        let body = self.body_at(review, revision, &location).await?;
        let mut anchor = anchors::create(revision, location, &body)?;
        anchors::follow(&mut anchor, files);
        Ok((anchor.status != AnchorStatus::Outdated).then_some(anchor.current))
    }
}

fn validate_hierarchy(graph: &ReviewGraph) -> Result<()> {
    let nodes: HashMap<_, _> = graph.nodes.iter().map(|node| (&node.id, node)).collect();
    for node in &graph.nodes {
        let mut seen = HashSet::from([&node.id]);
        let mut parent = node.parent.as_ref();
        while let Some(id) = parent {
            let ancestor = nodes.get(id).ok_or_else(|| {
                ReviewError::Invalid("Map parents must reference existing components".into())
            })?;
            if !seen.insert(id) || seen.len() > 4 {
                return Err(ReviewError::Invalid(
                    "Map hierarchy must be acyclic and at most four levels deep".into(),
                ));
            }
            parent = ancestor.parent.as_ref();
        }
    }
    Ok(())
}
