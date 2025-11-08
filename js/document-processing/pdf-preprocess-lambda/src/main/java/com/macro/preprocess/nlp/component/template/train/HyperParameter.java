package com.macro.preprocess.nlp.component.template.train;

import com.macro.preprocess.nlp.learning.Regularizer;
import com.macro.preprocess.nlp.learning.util.activation.ActivationFunction;
import com.macro.preprocess.nlp.learning.util.initialization.WeightGenerator;

public class HyperParameter {
    private int batch_size;
    private int max_epoch;
    private float learning_rate;
    private float decaying_rate;
    private float bias;
    private int feature_cutoff;
    private Regularizer l1_regularizer;
    private LOLS lols;
    private int[] hidden_dimensions;
    private ActivationFunction[] activation_functions;
    private float[] dropout_prob;
    private WeightGenerator weightGenerator;

    public HyperParameter() {
    }

    public int getFeature_cutoff() {
        return this.feature_cutoff;
    }

    public void setFeature_cutoff(int cutoff) {
        this.feature_cutoff = cutoff;
    }

    public int getBatchSize() {
        return this.batch_size;
    }

    public void setBatchSize(int size) {
        this.batch_size = size;
    }

    public int getMaxEpochs() {
        return this.max_epoch;
    }

    public void setMaxEpochs(int epochs) {
        this.max_epoch = epochs;
    }

    public float getLearningRate() {
        return this.learning_rate;
    }

    public void setLearningRate(float learningRate) {
        this.learning_rate = learningRate;
    }

    public Regularizer getL1Regularizer() {
        return this.l1_regularizer;
    }

    public void setL1Regularizer(Regularizer regularizer) {
        this.l1_regularizer = regularizer;
    }

    public boolean hasL1Regularizer() {
        return this.l1_regularizer != null;
    }

    public float getBias() {
        return this.bias;
    }

    public void setBias(float bias) {
        this.bias = bias;
    }

    public void setLOLS(LOLS lols) {
        this.lols = lols;
    }

    public LOLS getLOLS() {
        return this.lols;
    }

    public float getDecayingRate() {
        return this.decaying_rate;
    }

    public void setDecayingRate(float decayingRate) {
        this.decaying_rate = decayingRate;
    }

    public int[] getHiddenDimensions() {
        return this.hidden_dimensions;
    }

    public void setHiddenDimensions(int[] dimensions) {
        this.hidden_dimensions = dimensions;
    }

    public ActivationFunction[] getActivationFunctions() {
        return this.activation_functions;
    }

    public void setActivationFunctions(ActivationFunction[] functions) {
        this.activation_functions = functions;
    }

    public WeightGenerator getWeightGenerator() {
        return this.weightGenerator;
    }

    public void setWeightGenerator(WeightGenerator weightGenerator) {
        this.weightGenerator = weightGenerator;
    }

    public String toString(String prefix) {
        StringBuilder build = new StringBuilder();
        build.append(String.format("%s%s: %d\n", prefix, "Max epoch", this.max_epoch));
        if (this.batch_size > 0) {
            build.append(String.format("%s%s: %d\n", prefix, "Mini-batch", this.batch_size));
        }

        if (this.feature_cutoff > 0) {
            build.append(String.format("%s%s: %d\n", prefix, "Feature cutoff", this.feature_cutoff));
        }

        build.append(String.format("%s%s: %s\n", prefix, "Learning rate", this.learning_rate));
        if (this.decaying_rate > 0.0F) {
            build.append(String.format("%s%s: %s\n", prefix, "Decaying rate", this.decaying_rate));
        }

        if (this.bias > 0.0F) {
            build.append(String.format("%s%s: %s\n", prefix, "Bias", this.bias));
        }

        if (this.lols != null) {
            build.append(String.format("%s%s\n", prefix, this.lols.toString()));
        }

        if (this.l1_regularizer != null) {
            build.append(String.format("%s%s", prefix, this.l1_regularizer.toString()));
        }

        return build.toString();
    }

    public float[] getDropoutProb() {
        return this.dropout_prob;
    }

    public void setDropoutProb(float[] prob) {
        if (prob != null) {
            this.dropout_prob = (float[])prob.clone();
        }

    }
}