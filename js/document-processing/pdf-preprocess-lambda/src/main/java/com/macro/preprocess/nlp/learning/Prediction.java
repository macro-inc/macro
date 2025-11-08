package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.utils.MathUtils;

import java.io.Serializable;

public abstract class Prediction implements Serializable, Comparable<Prediction> {
    private static final long serialVersionUID = 4629812694101207696L;
    protected float score;

    public Prediction(float score) {
        this.setScore(score);
    }

    public float getScore() {
        return this.score;
    }

    public void setScore(float score) {
        this.score = score;
    }

    public int compareTo(Prediction o) {
        return MathUtils.signum((double)(this.score - o.score));
    }
}

