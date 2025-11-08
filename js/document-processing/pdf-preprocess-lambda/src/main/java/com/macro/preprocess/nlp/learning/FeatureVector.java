package com.macro.preprocess.nlp.learning;

import java.io.Serializable;

public class FeatureVector implements Serializable {
    private static final long serialVersionUID = -5213368916106070872L;
    private SparseVector sparse_vector;
    private float[] dense_vector;

    public FeatureVector() {
    }

    public FeatureVector(SparseVector sparseVector, float[] denseVector) {
        this.set(sparseVector, denseVector);
    }

    public FeatureVector(float[] denseVector, float bias) {
        this.set(new SparseVector(bias), denseVector);
    }

    public FeatureVector(SparseVector vector) {
        this.setSparseVector(vector);
    }

    public FeatureVector(float[] vector) {
        this.setDenseVector(vector);
    }

    public SparseVector getSparseVector() {
        return this.sparse_vector;
    }

    public float[] getDenseVector() {
        return this.dense_vector;
    }

    public void setSparseVector(SparseVector vector) {
        this.sparse_vector = vector;
    }

    public void setDenseVector(float[] vector) {
        this.dense_vector = vector;
    }

    public void set(SparseVector sparseVector, float[] denseVector) {
        this.setSparseVector(sparseVector);
        this.setDenseVector(denseVector);
    }

    public boolean hasSparseVector() {
        return this.sparse_vector != null;
    }

    public boolean hasDenseVector() {
        return this.dense_vector != null;
    }
}