package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.nlp.constants.StringConst;
import com.macro.preprocess.utils.Joiner;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;

public class SparseVector implements Serializable, Iterable<SparseItem> {
    private static final long serialVersionUID = -1427072719834760188L;
    private List<SparseItem> vector;
    private int max_index;

    public SparseVector() {
        this(0.0F);
    }

    public SparseVector(SparseVector v) {
        this(v, 0, v.size());
    }

    public SparseVector(SparseVector v, int beginIndex) {
        this(v, beginIndex, v.size());
    }

    public SparseVector(SparseVector v, int beginIndex, int endIndex) {
        this(0.0F);

        for(int i = beginIndex; i < endIndex; ++i) {
            this.add(v.get(i));
        }

    }

    public SparseVector(float bias) {
        this.vector = new ArrayList();
        this.addBias(bias);
        this.max_index = 0;
    }

    public SparseItem get(int index) {
        return (SparseItem)this.vector.get(index);
    }

    public void add(int index) {
        this.add(new SparseItem(index));
    }

    public void add(int index, float value) {
        this.add(new SparseItem(index, value));
    }

    public void add(SparseItem item) {
        this.vector.add(item);
        this.max_index = Math.max(this.max_index, item.getIndex());
    }

    public void addBias(float bias) {
        if (bias > 0.0F) {
            this.add(0, bias);
        }

    }

    public boolean isEmpty() {
        return this.vector.isEmpty();
    }

    public int size() {
        return this.vector.size();
    }

    public void sort() {
        Collections.sort(this.vector);
    }

    public int maxIndex() {
        return this.max_index;
    }

    public List<SparseItem> getVector() {
        return this.vector;
    }

    public Iterator<SparseItem> iterator() {
        return this.vector.iterator();
    }

    public String toString() {
        return Joiner.join(this.vector, StringConst.SPACE);
    }
}