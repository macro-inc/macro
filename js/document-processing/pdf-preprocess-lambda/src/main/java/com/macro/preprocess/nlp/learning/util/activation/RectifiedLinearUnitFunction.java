package com.macro.preprocess.nlp.learning.util.activation;

public class RectifiedLinearUnitFunction implements ActivationFunction {
    private static final long serialVersionUID = 2776457895707438981L;

    public RectifiedLinearUnitFunction() {
    }

    public void apply(float[] scores) {
        for(int index = 0; index < scores.length; ++index) {
            if (scores[index] < 0.0F) {
                scores[index] = 0.0F;
            }
        }

    }

    public String toString() {
        return "Relu";
    }
}