pub struct State<S>(S);

impl<S> State<S> {
    pub fn transition<F, U>(self, f: F) -> State<U>
    where
        F: FnOnce(S) -> U,
    {
        State(f(self.0))
    }
}
