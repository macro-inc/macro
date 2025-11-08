use std::collections::HashSet;

#[allow(dead_code)]
#[derive(Debug, Eq, Hash, PartialEq, Copy, Clone)]
pub struct Vertex<T> {
    pub data: T,
}

#[allow(dead_code)]
impl<T> Vertex<T> {
    pub fn new(x: T) -> Self {
        Vertex { data: x }
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct Edge<'a, T> {
    pub a: &'a Vertex<T>,
    pub b: &'a Vertex<T>,
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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
mod tests {
    use super::*;
    #[test]
    // initial edge/vertex setup
    fn test_init() {
        let a: Vertex<u32> = Vertex::new(1234);
        let b: Vertex<u32> = Vertex::new(5678);

        let edge: Edge<u32> = Edge { a: &a, b: &b };

        assert_eq!(edge.a.data, a.data);
        assert_eq!(edge.b.data, b.data);
    }

    #[test]
    // append operation
    fn test_append() {
        let a: Vertex<u32> = Vertex::new(1234);
        let b: Vertex<u32> = Vertex::new(5678);
        let c: Vertex<u32> = Vertex::new(1111);
        let c_id = c.data;

        let mut vset: HashSet<Vertex<u32>> = HashSet::new();
        let mut expected: HashSet<u32> = HashSet::new();
        expected.insert(a.data);
        expected.insert(b.data);

        vset.insert(a);
        vset.insert(b);

        let edges = append(&vset, &c);

        assert_eq!(edges.len(), 2);

        for edge in edges {
            assert_eq!(edge.a.data, c_id);
            assert!(expected.contains(&edge.b.data));
        }
    }

    #[test]
    // generate operation
    fn test_generate() {
        let a: Vertex<u32> = Vertex::new(1234);
        let b: Vertex<u32> = Vertex::new(5678);
        let c: Vertex<u32> = Vertex::new(6666);
        let d: Vertex<u32> = Vertex::new(7777);

        let expected_edges = [
            [a.data, b.data],
            [c.data, a.data],
            [c.data, b.data],
            [d.data, a.data],
            [d.data, b.data],
            [d.data, c.data],
        ];

        let mut vset: HashSet<Vertex<u32>> = HashSet::new();

        let mut expected_edges_lookup: HashSet<(u32, u32)> = HashSet::new();

        for edge in &expected_edges {
            expected_edges_lookup.insert((edge[0], edge[1]));
            // Insert phantom edge. Ordering of hashset is unknown
            expected_edges_lookup.insert((edge[1], edge[0]));
        }

        vset.insert(a);
        vset.insert(b);
        vset.insert(c);
        vset.insert(d);

        let edges = generate(&vset);

        assert_eq!(edges.len(), expected_edges.len());

        for edge in edges {
            assert!(
                expected_edges_lookup.contains(&(edge.a.data, edge.b.data)),
                "Could not find edge ({}, {})",
                edge.a.data,
                edge.b.data
            );
        }
    }
}
