use std::collections::{BTreeSet, HashSet};

/// A vertex in a graph, wrapping some data of type T.
/// This type implements referential eq and hashing
#[derive(Debug)]
pub struct Vertex<'a, T> {
    /// The data stored in this vertex.
    data: &'a T,
}

impl<'a, T> Clone for Vertex<'a, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<'a, T> Copy for Vertex<'a, T> {}

impl<'a, T> Vertex<'a, T> {
    /// return the pointer address of the &'a T
    fn address(&self) -> usize {
        let ptr: *const T = self.data;
        ptr as usize
    }
}

impl<'a, T> PartialEq for Vertex<'a, T> {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.data, other.data)
    }
}

impl<'a, T> Eq for Vertex<'a, T> {}

impl<'a, T> std::hash::Hash for Vertex<'a, T> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let ptr_address = self.address();
        ptr_address.hash(state);
    }
}

impl<'a, T> PartialOrd for Vertex<'a, T> {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl<'a, T> Ord for Vertex<'a, T> {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.address().cmp(&other.address())
    }
}

impl<'a, T> Vertex<'a, T> {
    /// Creates a new vertex with the given data.
    pub fn new(x: &'a T) -> Self {
        Vertex { data: x }
    }

    /// Returns a reference to the vertex's data with the original borrow lifetime.
    pub fn data(&self) -> &'a T {
        self.data
    }
}

/// An edge connecting two vertices in a graph.
#[derive(Debug)]
pub struct Edge<'a, T> {
    /// The first vertex of the edge.
    a: Vertex<'a, T>,
    /// The second vertex of the edge.
    b: Vertex<'a, T>,
}

impl<'a, T> Clone for Edge<'a, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<'a, T> Copy for Edge<'a, T> {}

impl<'a, T> PartialEq for Edge<'a, T> {
    fn eq(&self, other: &Self) -> bool {
        let a_eq = self.a == other.a || self.a == other.b;
        let b_eq = self.b == other.b || self.b == other.a;
        a_eq && b_eq
    }
}

impl<'a, T> Eq for Edge<'a, T> {}

impl<'a, T> std::hash::Hash for Edge<'a, T> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let a_addr = self.a.address();
        let b_addr = self.b.address();
        match a_addr.cmp(&b_addr) {
            std::cmp::Ordering::Less | std::cmp::Ordering::Equal => {
                a_addr.hash(state);
                b_addr.hash(state);
            }
            std::cmp::Ordering::Greater => {
                b_addr.hash(state);
                a_addr.hash(state);
            }
        }
    }
}

/// A graph of vertices and edges backed by borrowed node data.
pub struct UndirectedGraph<'a, T> {
    nodes: BTreeSet<Vertex<'a, T>>,
    edges: HashSet<Edge<'a, T>>,
}

impl<'a, T> Edge<'a, T> {
    /// return a reference to the inner vertex a
    pub fn a(&self) -> &Vertex<'a, T> {
        &self.a
    }
    /// return a reference to the inner vertex b
    pub fn b(&self) -> &Vertex<'a, T> {
        &self.b
    }
}

impl<'a, T> UndirectedGraph<'a, T> {
    /// Creates a new graph from an iterator of vertices.
    pub fn new(nodes: impl IntoIterator<Item = Vertex<'a, T>>) -> Self {
        UndirectedGraph {
            nodes: nodes.into_iter().collect(),
            edges: HashSet::new(),
        }
    }

    /// Returns an iterator over the graph's edges.
    pub fn edges(&self) -> impl Iterator<Item = Edge<'a, T>> {
        self.edges.iter().copied()
    }

    /// Generates all pairwise edges (complete graph) from a set of vertices.
    pub fn complete(self) -> CompleteUndirectedGraph<'a, T> {
        let UndirectedGraph { nodes, .. } = self;

        let edges = nodes
            .iter()
            .flat_map(|i| nodes.range(i..).map(move |j| (i, j)).skip(1))
            .map(|(i, j)| Edge { a: *i, b: *j })
            .collect();
        CompleteUndirectedGraph(UndirectedGraph { nodes, edges })
    }
}

/// A complete undirected graph where every pair of nodes is connected by an edge.
pub struct CompleteUndirectedGraph<'a, T>(UndirectedGraph<'a, T>);

impl<'a, T> CompleteUndirectedGraph<'a, T> {
    /// return a reference to the inner graph
    pub fn inner(&self) -> &UndirectedGraph<'a, T> {
        &self.0
    }
}

#[cfg(test)]
mod test;
