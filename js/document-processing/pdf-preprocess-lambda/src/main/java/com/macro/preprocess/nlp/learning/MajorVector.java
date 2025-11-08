package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.nlp.learning.util.initialization.WeightGenerator;
import org.magicwerk.brownies.collections.primitive.FloatGapList;

import java.io.Serializable;

public abstract class MajorVector implements Serializable {
    private static final long serialVersionUID = 4837958224356746566L;
    protected FloatGapList weights = new FloatGapList();
    protected int feature_size;
    protected int label_size;

    public MajorVector() {
        this.setSizes(0, 0);
    }

    public int getFeatureSize() {
        return this.feature_size;
    }

    public int getLabelSize() {
        return this.label_size;
    }

    public boolean expand(int labelSize, int featureSize) {
        return this.expand(labelSize, featureSize, (WeightGenerator)null);
    }

    public abstract boolean expand(int var1, int var2, WeightGenerator var3);

    protected boolean expand(int oldRowSize, int oldColumnSize, int newRowSize, int newColumnSize, WeightGenerator generator) {
        if (newRowSize < oldRowSize) {
            newRowSize = oldRowSize;
        }

        if (newColumnSize < oldColumnSize) {
            newColumnSize = oldColumnSize;
        }

        boolean expanded = false;
        int i;
        int j;
        if (oldColumnSize < newColumnSize) {
            int diff = newColumnSize - oldColumnSize;
            int size = oldRowSize * newColumnSize;

            for(i = oldColumnSize; i < size; i += newColumnSize) {
                for(j = 0; j < diff; ++j) {
                    this.weights.add(i + j, generator == null ? 0.0F : generator.next());
                }
            }

            this.setColumnSize(newColumnSize);
            expanded = true;
        }

        if (oldRowSize < newRowSize) {
            j = newRowSize * newColumnSize;

            for(i = this.weights.size(); i < j; ++i) {
                this.weights.add(generator == null ? 0.0F : generator.next());
            }

            this.setRowSize(newRowSize);
            expanded = true;
        }

        return expanded;
    }

    protected abstract void setRowSize(int var1);

    protected abstract void setColumnSize(int var1);

    public float get(int index) {
        return this.weights.get(index);
    }

    public void set(int index, float value) {
        this.weights.set(index, value);
    }

    public void add(int index, float value) {
        this.set(index, this.get(index) + value);
    }

    public void add(float value) {
        for(int i = 0; i < this.size(); ++i) {
            this.add(i, value);
        }

    }

    public void multiply(int index, float value) {
        this.set(index, this.get(index) * value);
    }

    public void multiply(float value) {
        for(int i = 0; i < this.size(); ++i) {
            this.multiply(i, value);
        }

    }

    public void fill(float value) {
        for(int i = 0; i < this.size(); ++i) {
            this.set(i, value);
        }

    }

    public int size() {
        return this.weights.size();
    }

    public abstract int indexOf(int var1, int var2);

    public float get(int y, int xi) {
        return this.get(this.indexOf(y, xi));
    }

    public void set(int y, int xi, float value) {
        this.set(this.indexOf(y, xi), value);
    }

    public void add(int y, int xi, float value) {
        this.add(this.indexOf(y, xi), value);
    }

    public void multiply(int y, int xi, float value) {
        this.multiply(this.indexOf(y, xi), value);
    }

    public abstract void addScores(SparseVector var1, float[] var2);

    public abstract void addScores(float[] var1, float[] var2);

    protected abstract MajorVector createInstance();

    public MajorVector createZeroVector() {
        MajorVector vector = this.createInstance();
        vector.setSizes(this.label_size, this.feature_size);
        vector.weights = new FloatGapList();

        for(int i = 0; i < this.weights.size(); ++i) {
            vector.weights.add(0.0F);
        }

        return vector;
    }

    public int countNonZeroWeights() {
        int count = 0;

        for(int i = 0; i < this.size(); ++i) {
            if (this.get(i) != 0.0F) {
                ++count;
            }
        }

        return count;
    }

    protected void setSizes(int labelSize, int featureSize) {
        this.feature_size = featureSize;
        this.label_size = labelSize;
    }

    public String toString() {
        return this.weights.toString();
    }
}