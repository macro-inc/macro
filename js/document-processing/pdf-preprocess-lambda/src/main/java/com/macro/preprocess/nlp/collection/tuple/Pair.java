package com.macro.preprocess.nlp.collection.tuple;

import java.io.Serializable;

public class Pair<T1, T2> implements Serializable {
    private static final long serialVersionUID = 8447270640444415417L;
    public T1 o1;
    public T2 o2;

    public Pair(T1 o1, T2 o2) {
        this.set(o1, o2);
    }

    public void set(T1 o1, T2 o2) {
        this.o1 = o1;
        this.o2 = o2;
    }
}
