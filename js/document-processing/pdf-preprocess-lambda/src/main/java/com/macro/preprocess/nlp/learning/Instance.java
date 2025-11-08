package com.macro.preprocess.nlp.learning;

import java.io.Serializable;

public class Instance implements Serializable {
    private static final long serialVersionUID = 7998185354380065988L;
    private FeatureVector vector;
    private float[] scores;
    private String string_label;
    private int gold_label;
    private int predicted_label;

    public Instance(String label, FeatureVector vector) {
        this.setStringLabel(label);
        this.setFeatureVector(vector);
    }

    public Instance(String label, SparseVector sparseVector, float[] denseVector) {
        this.setStringLabel(label);
        this.setFeatureVector(new FeatureVector(sparseVector, denseVector));
    }

    public Instance(String label, SparseVector vector) {
        this.setStringLabel(label);
        this.setFeatureVector(new FeatureVector(vector));
    }

    public Instance(String label, float[] vector) {
        this.setStringLabel(label);
        this.setFeatureVector(new FeatureVector(vector));
    }

    public Instance(int label, FeatureVector vector) {
        this.setGoldLabel(label);
        this.setFeatureVector(vector);
    }

    public Instance(int label, SparseVector sparseVector, float[] denseVector) {
        this.setGoldLabel(label);
        this.setFeatureVector(new FeatureVector(sparseVector, denseVector));
    }

    public Instance(int label, SparseVector vector) {
        this.setGoldLabel(label);
        this.setFeatureVector(new FeatureVector(vector));
    }

    public Instance(int label, float[] vector) {
        this.setGoldLabel(label);
        this.setFeatureVector(new FeatureVector(vector));
    }

    public String getStringLabel() {
        return this.string_label;
    }

    public void setStringLabel(String label) {
        this.string_label = label;
    }

    public boolean hasStringLabel() {
        return this.string_label != null;
    }

    public boolean isStringLabel(String label) {
        return label.equals(this.string_label);
    }

    public int getGoldLabel() {
        return this.gold_label;
    }

    public void setGoldLabel(int label) {
        this.gold_label = label;
    }

    public boolean isGoldLabel(int label) {
        return label == this.gold_label;
    }

    public int getPredictedLabel() {
        return this.predicted_label;
    }

    public void setPredictedLabel(int label) {
        this.predicted_label = label;
    }

    public FeatureVector getFeatureVector() {
        return this.vector;
    }

    public void setFeatureVector(FeatureVector vector) {
        this.vector = vector;
    }

    public float[] getScores() {
        return this.scores;
    }

    public void setScores(float[] scores) {
        this.scores = scores;
    }

    public boolean hasScores() {
        return this.scores != null;
    }
}
