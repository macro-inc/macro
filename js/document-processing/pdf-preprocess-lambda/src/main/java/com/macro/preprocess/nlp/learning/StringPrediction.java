package com.macro.preprocess.nlp.learning;

public class StringPrediction extends Prediction {
    private static final long serialVersionUID = 4629812694101207696L;
    private String label;

    public StringPrediction(String label, float score) {
        super(score);
        this.setLabel(label);
    }

    public String getLabel() {
        return this.label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public boolean isLabel(String label) {
        return label.equals(this.label);
    }

    public void copy(StringPrediction p) {
        this.set(p.label, p.score);
    }

    public void set(String label, float score) {
        this.setLabel(label);
        this.setScore(score);
    }

    public String toString() {
        return this.label + ":" + this.score;
    }
}
