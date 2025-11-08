package com.macro.preprocess.nlp.collection.tuple;

import java.io.Serializable;

public class DoubleIntPair implements Serializable {
    private static final long serialVersionUID = -2439322004395455224L;
    public double d;
    public int i;

    public DoubleIntPair(double d, int i) {
        this.set(d, i);
    }

    public void set(double d, int i) {
        this.d = d;
        this.i = i;
    }
}
