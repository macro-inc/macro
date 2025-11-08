package com.macro.preprocess.nlp.learning.optimization.reguralization;

import com.macro.preprocess.nlp.learning.MajorVector;
import com.macro.preprocess.nlp.learning.Regularizer;
import com.macro.preprocess.nlp.learning.WeightVector;

public class RegularizedDualAveraging extends Regularizer {
    private static final long serialVersionUID = 743778452022307338L;
    private WeightVector weight_vector;
    private WeightVector cumulative_penalty;

    public RegularizedDualAveraging(float rate) {
        super(rate);
    }

    public WeightVector getWeightVector() {
        return this.weight_vector;
    }

    public WeightVector getCumulativePenaltyVector() {
        return this.cumulative_penalty;
    }

    public void setWeightVector(WeightVector vector) {
        this.weight_vector = vector;
        this.cumulative_penalty = vector.createZeroVector();
    }

    public void expand(int sparseFeatureSize, int denseFeatureSize, int labelSize) {
        this.cumulative_penalty.expand(sparseFeatureSize, denseFeatureSize, labelSize);
    }

    public void updateWeight(int index, float gradient, float learningRate, int steps, boolean sparse) {
        MajorVector cum = this.cumulative_penalty.getMajorVector(sparse);
        cum.add(index, gradient);
        float penalty = cum.get(index);
        float l1 = this.rate * (float)steps;
        float value;
        if (Math.abs(penalty) <= l1) {
            value = 0.0F;
        } else {
            value = learningRate * (penalty - Math.signum(penalty) * l1);
        }

        this.weight_vector.getMajorVector(sparse).set(index, value);
    }

    public String toString() {
        return String.format("RDA: %s", this.rate);
    }
}
