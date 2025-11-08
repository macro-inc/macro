package com.macro.preprocess.nlp.collection.tuple;

import java.io.Serializable;

public class ObjectIntPair<T> implements Serializable, Comparable<ObjectIntPair<T>> {
    private static final long serialVersionUID = -5228607179375724504L;
    public T o;
    public int i;

    public ObjectIntPair() {
        this.set(null, 0);
    }

    public ObjectIntPair(T o, int i) {
        this.set(o, i);
    }

    public void set(T o, int i) {
        this.o = o;
        this.i = i;
    }

    public int compareTo(ObjectIntPair<T> p) {
        return this.i - p.i;
    }

    public String toString() {
        return "(" + this.o.toString() + "," + this.i + ")";
    }
}