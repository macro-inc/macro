package com.macro.preprocess.nlp.learning.util.activation;

public class SoftplusFunction implements ActivationFunction {
    private static final long serialVersionUID = -3123516253479799668L;

    public SoftplusFunction() {
    }

    public void apply(float[] scores) {
        for(int index = 0; index < scores.length; ++index) {
            scores[index] = (float)Math.log(1.0 + Math.exp((double)scores[index]));
        }

    }

    public String toString() {
        return "Softplus";
    }
}