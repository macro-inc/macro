package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.nlp.learning.util.initialization.WeightGenerator;

import java.util.Iterator;

public class RowMajorVector extends MajorVector {
    private static final long serialVersionUID = -3004240061242740599L;

    public RowMajorVector() {
    }

    public boolean expand(int labelSize, int featureSize, WeightGenerator generator) {
        return this.expand(this.label_size, this.feature_size, labelSize, featureSize, generator);
    }

    public int indexOf(int y, int xi) {
        return y * this.feature_size + xi;
    }

    protected MajorVector createInstance() {
        return new RowMajorVector();
    }

    public void addScores(SparseVector x, float[] scores) {
        for(int i = 0; i < scores.length; ++i) {
            int index = i * this.feature_size;
            Iterator var5 = x.iterator();

            while(var5.hasNext()) {
                SparseItem p = (SparseItem)var5.next();
                if (p.getIndex() < this.getFeatureSize()) {
                    scores[i] += this.get(index + p.getIndex()) * p.getValue();
                }
            }
        }

    }

    public void addScores(float[] x, float[] scores) {
        int index = 0;

        for(int i = 0; i < scores.length; ++i) {
            for(int j = 0; j < x.length; ++j) {
                scores[i] += this.get(index++) * x[j];
            }
        }

    }

    protected void setRowSize(int size) {
        this.label_size = size;
    }

    protected void setColumnSize(int size) {
        this.feature_size = size;
    }
}