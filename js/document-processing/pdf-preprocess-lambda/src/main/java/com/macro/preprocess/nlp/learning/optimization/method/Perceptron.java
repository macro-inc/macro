package com.macro.preprocess.nlp.learning.optimization.method;

import com.macro.preprocess.nlp.learning.optimization.StochasticGradientDescent;
import com.macro.preprocess.nlp.learning.Instance;
import com.macro.preprocess.nlp.learning.WeightVector;

public class Perceptron extends StochasticGradientDescent {
    private static final long serialVersionUID = 4996609767585176672L;

    public Perceptron(WeightVector vector, float learningRate, float bias) {
        super(vector, learningRate, bias);
    }

    public void trainAux(Instance instance) {
        this.trainClassification(instance);
    }

    protected int getPredictedLabel(Instance instance) {
        float[] scores = instance.getScores();
        return this.argmax(scores);
    }

    protected float getLearningRate(int index, boolean sparse) {
        return this.learning_rate;
    }

    public void updateMiniBatch() {
    }

    public String toString() {
        return "Perceptron";
    }
}