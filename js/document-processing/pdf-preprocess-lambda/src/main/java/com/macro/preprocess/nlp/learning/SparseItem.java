package com.macro.preprocess.nlp.learning;

import java.io.Serializable;

public class SparseItem implements Serializable, Comparable<SparseItem> {
    private static final long serialVersionUID = -8933673050278448784L;
    private int index;
    private float value;

    public SparseItem(int index) {
        this(index, 1.0F);
    }

    public SparseItem(int index, float value) {
        this.set(index, value);
    }

    public int getIndex() {
        return this.index;
    }

    public float getValue() {
        return this.value;
    }

    public void setIndex(int index) {
        this.index = index;
    }

    public void setValue(float value) {
        this.value = value;
    }

    public void set(int index, float value) {
        this.setIndex(index);
        this.setValue(value);
    }

    public void set(SparseItem item) {
        this.set(item.index, item.value);
    }

    public int compareTo(SparseItem o) {
        return this.index - o.index;
    }

    public String toString() {
        return this.index + ":" + this.value;
    }
}