package com.macro.preprocess.nlp.collection.tree;

import java.util.HashMap;

public class PrefixNode<K extends Comparable<K>, V> extends HashMap<K, PrefixNode<K, V>> {
    private static final long serialVersionUID = 1566684742873455351L;
    private V value = null;

    public PrefixNode() {
    }

    public V getValue() {
        return this.value;
    }

    public void setValue(V value) {
        this.value = value;
    }

    public boolean hasValue() {
        return this.value != null;
    }
}