package com.macro.preprocess.nlp.learning;

import java.io.Serializable;

public abstract class Regularizer implements Serializable {
    private static final long serialVersionUID = 608089379202097302L;
    protected float rate;

    public Regularizer(float rate) {
        this.setRate(rate);
    }

    public float getRate() {
        return this.rate;
    }

    public void setRate(float rate) {
        this.rate = rate;
    }

    public abstract void setWeightVector(WeightVector var1);

    public abstract void expand(int var1, int var2, int var3);

    public abstract void updateWeight(int var1, float var2, float var3, int var4, boolean var5);
}