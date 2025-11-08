package com.macro.preprocess.nlp.learning.optimization.method;

import com.macro.preprocess.nlp.learning.optimization.StochasticGradientDescent;
import com.macro.preprocess.nlp.learning.Instance;
import com.macro.preprocess.nlp.learning.WeightVector;
import com.macro.preprocess.nlp.learning.util.activation.SoftmaxFunction;

public class SoftmaxRegression extends StochasticGradientDescent {
    private static final long serialVersionUID = -7590203168051761804L;

    public SoftmaxRegression(WeightVector vector, float learningRate, float bias) {
        super(vector, learningRate, bias);
        if (!vector.hasActivationFunction()) {
            vector.setActivationFunction(new SoftmaxFunction());
        }

    }

    public void trainAux(Instance instance) {
        float[] gradients = this.getGradientsRegression(instance);
        this.trainRegression(instance, gradients);
    }

    protected int getPredictedLabel(Instance instance) {
        return this.getPredictedLabelRegression(instance);
    }

    protected float getLearningRate(int index, boolean sparse) {
        return this.learning_rate;
    }

    public void updateMiniBatch() {
    }

    public String toString() {
        return "Softmax Regression";
    }
}
