package com.macro.preprocess.nlp.collection.tuple;

import java.io.Serializable;

public class ObjectIntIntTriple<T> implements Serializable {
    private static final long serialVersionUID = -7014586350906455183L;
    public T o;
    public int i1;
    public int i2;

    public ObjectIntIntTriple() {
        this.set(null, 0, 0);
    }

    public ObjectIntIntTriple(T o, int i1, int i2) {
        this.set(o, i1, i2);
    }

    public void set(T o, int i1, int i2) {
        this.o = o;
        this.i1 = i1;
        this.i2 = i2;
    }
}
