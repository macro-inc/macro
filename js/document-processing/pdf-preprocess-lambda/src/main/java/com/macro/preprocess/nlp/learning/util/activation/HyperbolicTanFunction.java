package com.macro.preprocess.nlp.learning.util.activation;

public class HyperbolicTanFunction implements ActivationFunction {
    private static final long serialVersionUID = 6581919225914864529L;

    public HyperbolicTanFunction() {
    }

    public void apply(float[] scores) {
        for(int index = 0; index < scores.length; ++index) {
            scores[index] = (float)Math.tanh((double)scores[index]);
        }

    }

    public String toString() {
        return "Tanh";
    }
}