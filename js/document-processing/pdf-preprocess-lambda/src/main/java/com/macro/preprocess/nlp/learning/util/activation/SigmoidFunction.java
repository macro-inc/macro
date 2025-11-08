package com.macro.preprocess.nlp.learning.util.activation;

import com.macro.preprocess.nlp.common.util.Sigmoid;

public class SigmoidFunction implements ActivationFunction {
    private static final long serialVersionUID = 242731926367876732L;
    private Sigmoid table;

    public SigmoidFunction() {
        this.table = new Sigmoid();
    }

    public SigmoidFunction(int size, float floor, float ceiling) {
        this.table = new Sigmoid(size, floor, ceiling);
    }

    public void apply(float[] scores) {
        for(int i = 0; i < scores.length; ++i) {
            scores[i] = this.table.get(scores[i]);
        }

    }

    public String toString() {
        return "Sigmoid";
    }
}