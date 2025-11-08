package com.macro.preprocess.nlp.learning.util.activation;

import org.apache.commons.math3.util.FastMath;

public class SoftmaxFunction implements ActivationFunction {
    private static final long serialVersionUID = -3091974476056808242L;

    public SoftmaxFunction() {
    }

    public void apply(float[] scores) {
        float sum = 0.0F;
        float max = 0.0F;

        int i;
        for(i = 0; i < scores.length; ++i) {
            scores[i] = (float) FastMath.exp(scores[i] - max);
            sum += scores[i];
        }

        sum = 1.0F / (1.0F + sum);

        for(i = 0; i < scores.length; ++i) {
            scores[i] *= sum;
        }

    }

    public String toString() {
        return "Softmax";
    }
}