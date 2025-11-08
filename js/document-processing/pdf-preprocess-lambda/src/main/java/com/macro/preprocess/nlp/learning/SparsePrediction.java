package com.macro.preprocess.nlp.learning;

public class SparsePrediction extends Prediction {
    private static final long serialVersionUID = -2873195048974695284L;
    private int label;

    public SparsePrediction(int label, float score) {
        super(score);
        this.setLabel(label);
    }

    public int getLabel() {
        return this.label;
    }

    public void setLabel(int label) {
        this.label = label;
    }

    public void copy(SparsePrediction p) {
        this.set(p.label, p.score);
    }

    public void set(int label, float score) {
        this.setLabel(label);
        this.setScore(score);
    }

    public String toString() {
        return this.label + ":" + this.score;
    }
}
