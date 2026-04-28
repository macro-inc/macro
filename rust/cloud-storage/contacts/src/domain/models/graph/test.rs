use super::*;

#[test]
fn test_init() {
    let a_val: u32 = 1234;
    let b_val: u32 = 5678;
    let graph = UndirectedGraph::new([Vertex::new(&a_val), Vertex::new(&b_val)]).complete();
    let edges: Vec<_> = graph.inner().edges().collect();
    assert_eq!(edges.len(), 1);
    let vals = [*edges[0].a().data(), *edges[0].b().data()];
    assert!(vals.contains(&1234));
    assert!(vals.contains(&5678));
}

#[test]
fn test_generate() {
    let vals: [u32; 4] = [1234, 5678, 6666, 7777];
    let graph = UndirectedGraph::new(vals.iter().map(Vertex::new)).complete();
    let edges: Vec<_> = graph.inner().edges().collect();

    assert_eq!(edges.len(), 6);

    let expected: HashSet<(u32, u32)> = [
        (1234, 5678),
        (1234, 6666),
        (1234, 7777),
        (5678, 6666),
        (5678, 7777),
        (6666, 7777),
    ]
    .into_iter()
    .flat_map(|(a, b)| [(a, b), (b, a)])
    .collect();

    for edge in &edges {
        let a = *edge.a().data();
        let b = *edge.b().data();
        assert!(expected.contains(&(a, b)), "Unexpected edge ({a}, {b})",);
    }
}

#[test]
fn test_vertex_same_ref_eq() {
    let val: u32 = 42;
    let v1 = Vertex::new(&val);
    let v2 = Vertex::new(&val);
    assert_eq!(v1, v2);
}

#[test]
fn test_vertex_different_alloc_neq() {
    let a: u32 = 42;
    let b: u32 = 42;
    let v1 = Vertex::new(&a);
    let v2 = Vertex::new(&b);
    assert_ne!(v1, v2);
}

#[test]
fn test_edge_unordered_eq() {
    let a_val: u32 = 1;
    let b_val: u32 = 2;
    let a = Vertex::new(&a_val);
    let b = Vertex::new(&b_val);
    let e1 = Edge { a, b };
    let e2 = Edge { a: b, b: a };
    assert_eq!(e1, e2);
}

#[test]
fn test_edge_neq() {
    let a_val: u32 = 1;
    let b_val: u32 = 2;
    let c_val: u32 = 3;
    let a = Vertex::new(&a_val);
    let b = Vertex::new(&b_val);
    let c = Vertex::new(&c_val);
    let e1 = Edge { a, b };
    let e2 = Edge { a, b: c };
    assert_ne!(e1, e2);
}

#[test]
fn test_edge_dedup_in_hashset() {
    let a_val: u32 = 1;
    let b_val: u32 = 2;
    let a = Vertex::new(&a_val);
    let b = Vertex::new(&b_val);
    let mut set: HashSet<Edge<u32>> = HashSet::new();
    set.insert(Edge { a, b });
    set.insert(Edge { a: b, b: a });
    assert_eq!(set.len(), 1);
}
