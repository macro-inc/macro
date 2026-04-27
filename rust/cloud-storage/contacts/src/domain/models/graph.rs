use std::collections::HashSet;

/// A vertex in a graph, wrapping some data of type T.
#[derive(Debug, Eq, Hash, PartialEq, Copy, Clone)]
pub struct Vertex<T> {
    /// The data stored in this vertex.
    pub data: T,
}

impl<T> Vertex<T> {
    /// Creates a new vertex with the given data.
    pub fn new(x: T) -> Self {
        Vertex { data: x }
    }
}

/// An edge connecting two vertices in a graph.
#[derive(Debug)]
pub struct Edge<'a, T> {
    /// The first vertex of the edge.
    pub a: &'a Vertex<T>,
    /// The second vertex of the edge.
    pub b: &'a Vertex<T>,
}

/// Creates edges from a single vertex to every vertex in the given set.
pub fn append<'a, T>(
    vertex_set: &'a HashSet<Vertex<T>>,
    vertex: &'a Vertex<T>,
) -> Vec<Edge<'a, T>> {
    let mut new_edges = vec![];
    for vtx in vertex_set {
        new_edges.push(Edge { a: vertex, b: vtx });
    }

    new_edges
}

/// Generates all pairwise edges (complete graph) from a set of vertices.
pub fn generate<T>(vertex_set: &HashSet<Vertex<T>>) -> Vec<Edge<'_, T>> {
    let mut edges = vec![];

    let elements: Vec<&Vertex<T>> = vertex_set.iter().collect();

    for i in 0..elements.len() {
        for j in i + 1..elements.len() {
            edges.push(Edge {
                a: elements[i],
                b: elements[j],
            });
        }
    }

    edges
}

#[cfg(test)]
mod test;
