package com.macro.preprocess.nlp.collection.tuple;

import com.macro.preprocess.utils.MathUtils;

import java.io.Serializable;

public class ObjectDoublePair<T> implements Serializable, Comparable<ObjectDoublePair<T>> {
    private static final long serialVersionUID = -5228607179375724504L;
    public T o;
    public double d;

    public ObjectDoublePair(T o, double d) {
        this.set(o, d);
    }

    public void set(T o, double d) {
        this.o = o;
        this.d = d;
    }

    public T getObject() {
        return this.o;
    }

    public double getDouble() {
        return this.d;
    }

    public int compareTo(ObjectDoublePair<T> p) {
        return MathUtils.signum(this.d - p.d);
    }

    public String toString() {
        return "(" + this.o.toString() + "," + this.d + ")";
    }
}