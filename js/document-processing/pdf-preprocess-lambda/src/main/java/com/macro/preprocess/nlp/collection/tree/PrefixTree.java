package com.macro.preprocess.nlp.collection.tree;

import com.macro.preprocess.nlp.collection.tuple.ObjectIntIntTriple;
import com.macro.preprocess.nlp.collection.tuple.ObjectIntPair;
import com.macro.preprocess.utils.DSUtils;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

public class PrefixTree<K extends Comparable<K>, V> implements Serializable {
    private static final long serialVersionUID = 6471355272521434323L;
    private PrefixNode<K, V> n_root = new PrefixNode();

    public PrefixTree() {
    }

    public PrefixNode<K, V> getRoot() {
        return this.n_root;
    }

    public void setRoot(PrefixNode<K, V> node) {
        this.n_root = node;
    }

    public <A> PrefixNode<K, V> add(A[] keys, int beginIndex, int endIndex, Function<A, K> f) {
        PrefixNode<K, V> curr = this.n_root;

        for(int i = beginIndex; i < endIndex; ++i) {
            PrefixNode<K, V> next = (PrefixNode)curr.get(keys[i]);
            if (next == null) {
                next = new PrefixNode();
                curr.put(f.apply(keys[i]), next);
            }

            curr = next;
        }

        return curr;
    }

    public <A> void set(A[] keys, V value, Function<A, K> f) {
        this.add(keys, 0, keys.length, f).setValue(value);
    }

    public <A> ObjectIntPair<V> get(A[] keys, int beginIndex, Function<A, K> f) {
        ObjectIntPair<V> p = new ObjectIntPair();
        PrefixNode<K, V> curr = this.n_root;
        int len = keys.length;

        for(int i = beginIndex; i < len; ++i) {
            curr = (PrefixNode)curr.get(f.apply(keys[i]));
            if (curr == null) {
                break;
            }

            if (curr.hasValue()) {
                p.set(curr.getValue(), i);
            }
        }

        return p.o != null ? p : null;
    }

    public <A> PrefixNode<K, V> get(A[] keys, int beginIndex, int endIndex, Function<A, K> f) {
        PrefixNode<K, V> curr = this.n_root;

        for(int i = beginIndex; i < endIndex; ++i) {
            curr = (PrefixNode)curr.get(f.apply(keys[i]));
            if (curr == null) {
                return null;
            }
        }

        return curr;
    }

    public <A> List<ObjectIntIntTriple<V>> getAll(A[] array, int beginIndex, Function<A, K> f, boolean removeSubset, boolean removeOverlap) {
        List<ObjectIntIntTriple<V>> list = new ArrayList();
        int size = array.length;

        for(int i = beginIndex; i < size; ++i) {
            this.getAllAux(array, i, f, list, removeSubset, removeOverlap);
        }

        return list;
    }

    private <A> void getAllAux(A[] keys, int beginIndex, Function<A, K> f, List<ObjectIntIntTriple<V>> list, boolean removeSubset, boolean removeOverlap) {
        ObjectIntPair<V> v = this.get(keys, beginIndex, f);
        if (v != null) {
            ObjectIntIntTriple<V> t = (ObjectIntIntTriple) DSUtils.getLast(list);
            if (!removeSubset || t == null || t.i2 < v.i) {
                if (removeOverlap && t != null && t.i2 >= beginIndex) {
                    if (t.i2 - t.i1 >= v.i - beginIndex) {
                        return;
                    }

                    DSUtils.removeLast(list);
                }

                list.add(new ObjectIntIntTriple(v.o, beginIndex, v.i));
            }
        }
    }
}