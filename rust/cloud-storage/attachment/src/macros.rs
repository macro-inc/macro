#[macro_export]
/// A tuple struct with a [`NonEmpty`] collection and some helper methods
macro_rules! non_empty_collection {
    (
        $(#[$meta:meta])*
        $vis:vis struct $name:ident($item:ty);
    ) => {
        $(#[$meta])*
        $vis struct $name(NonEmpty<Vec<$item>>);

        impl $name {
            /// Wrap a non-empty vec.
            $vis fn new(parts: NonEmpty<Vec<$item>>) -> Self {
                Self(parts)
            }

            /// Build from a single item.
            $vis fn one(part: $item) -> Self {
                Self(NonEmpty::new(vec![part]).expect("single element is non-empty"))
            }

            /// Borrow the underlying parts.
            $vis fn parts(&self) -> &NonEmpty<Vec<$item>> {
                &self.0
            }

            /// Consume into the underlying parts.
            $vis fn into_parts(self) -> NonEmpty<Vec<$item>> {
                self.0
            }
            /// Prepend an item to the front of the collection.
            $vis fn prepend(self, item: $item) -> Self {
                let mut inner = self.0.into_inner();
                inner.insert(0, item);
                Self(NonEmpty::new(inner).expect("prepend cannot be empty"))
            }
            /// Append an item to the end of the collection.
            $vis fn append(self, item: $item) -> Self {
                let mut inner = self.0.into_inner();
                inner.push(item);
                Self(NonEmpty::new(inner).expect("append cannot be empty"))
            }

            /// Apply a function to each item.
            $vis fn map(self, f: impl FnMut($item) -> $item) -> Self {
                Self(NonEmpty::new(self.0
                    .into_inner()
                    .into_iter()
                    .map(f)
                    .collect())
                    .expect("map cannot be empty"))
            }
        }
    };
}
