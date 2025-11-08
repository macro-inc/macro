package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.nlp.learning.util.initialization.WeightGenerator;

import java.util.List;

public class ColumnMajorVector extends MajorVector {
    private static final long serialVersionUID = 6995117853244310932L;

    public ColumnMajorVector() {
    }

    public boolean expand(int labelSize, int featureSize, WeightGenerator generator) {
        return this.expand(this.feature_size, this.label_size, featureSize, labelSize, generator);
    }

    public int indexOf(int y, int xi) {
        return y + xi * this.label_size;
    }

    protected MajorVector createInstance() {
        return new ColumnMajorVector();
    }

    public void addScores(SparseVector x, float[] scores) {
        List<SparseItem> itemVector = x.getVector();
        int featureSize = this.getFeatureSize();
        itemVector.stream().filter((p) -> {
            return p.getIndex() < featureSize;
        }).forEach((p) -> {
            int index = p.getIndex() * this.label_size;

            for(int i = 0; i < scores.length; ++i) {
                scores[i] += this.get(index++) * p.getValue();
            }

        });
    }

    public void addScores(float[] x, float[] scores) {
        int index = 0;

        for(int j = 0; j < x.length; ++j) {
            for(int i = 0; i < scores.length; ++i) {
                scores[i] += this.get(index++) * x[j];
            }
        }

    }

    protected void setRowSize(int size) {
        this.feature_size = size;
    }

    protected void setColumnSize(int size) {
        this.label_size = size;
    }
}