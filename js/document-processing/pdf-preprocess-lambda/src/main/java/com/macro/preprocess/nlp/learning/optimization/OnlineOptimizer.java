package com.macro.preprocess.nlp.learning.optimization;

import com.macro.preprocess.nlp.learning.*;
import com.macro.preprocess.utils.MathUtils;
import com.macro.preprocess.nlp.component.template.train.HyperParameter;

import java.io.Serializable;
import java.util.Arrays;
import java.util.Collection;
import java.util.Iterator;
import java.util.StringJoiner;

public abstract class OnlineOptimizer implements Serializable {
    private static final long serialVersionUID = -7750497048585331648L;
    protected WeightVector weight_vector;
    protected LabelMap label_map;
    protected float bias;
    protected transient Regularizer l1_regularizer;
    protected transient float learning_rate;
    protected transient int steps;

    public OnlineOptimizer(WeightVector vector, float learningRate, float bias) {
        this(vector, learningRate, bias, (Regularizer)null);
    }

    public OnlineOptimizer(WeightVector vector, float learningRate, float bias, Regularizer l1) {
        this.label_map = new LabelMap();
        this.setWeightVector(vector);
        this.setBias(bias);
        this.setLearningRate(learningRate);
        this.setL1Regularizer(l1);
        this.steps = 1;
    }

    public void adapt(HyperParameter hp) {
        this.setL1Regularizer(hp.getL1Regularizer());
        this.setLearningRate(hp.getLearningRate());
    }

    public WeightVector getWeightVector() {
        return this.weight_vector;
    }

    public void setWeightVector(WeightVector vector) {
        this.weight_vector = vector;
    }

    public float getLearningRate() {
        return this.learning_rate;
    }

    public void setLearningRate(float rate) {
        this.learning_rate = rate;
    }

    public float getBias() {
        return this.bias;
    }

    public void setBias(float bias) {
        this.bias = bias;
    }

    public Regularizer getL1Regularizer() {
        return this.l1_regularizer;
    }

    public void setL1Regularizer(Regularizer l1) {
        this.l1_regularizer = l1;
        if (this.isL1Regularization()) {
            this.l1_regularizer.setWeightVector(this.weight_vector);
        }

    }

    public boolean isL1Regularization() {
        return this.l1_regularizer != null;
    }

    public void setLabelMap(LabelMap map) {
        this.label_map = map;
    }

    public LabelMap getLabelMap() {
        return this.label_map;
    }

    public String getLabel(int index) {
        return this.label_map.getLabel(index);
    }

    public int getLabelIndex(String label) {
        return this.label_map.index(label);
    }

    public int[] getLabelIndexArray(Collection<String> labels) {
        return labels.stream().mapToInt((s) -> {
            return this.getLabelIndex(s);
        }).toArray();
    }

    public int getLabelSize() {
        return this.label_map.size();
    }

    public int addLabel(String label) {
        return this.label_map.add(label);
    }

    public void addLabels(Collection<String> labels) {
        Iterator var2 = labels.iterator();

        while(var2.hasNext()) {
            String label = (String)var2.next();
            this.addLabel(label);
        }

    }

    public void train(Instance instance) {
        this.train(instance, true);
    }

    public void train(Instance instance, boolean augment) {
        if (augment) {
            this.augment(instance);
        }

        this.expand(instance.getFeatureVector());
        if (instance.hasScores() && instance.getScores().length == this.getLabelSize()) {
            this.addScores(instance.getFeatureVector(), instance.getScores());
        } else {
            instance.setScores(this.scores(instance.getFeatureVector()));
        }

        int yhat = this.getPredictedLabel(instance);
        instance.setPredictedLabel(yhat);
        if (!instance.isGoldLabel(yhat)) {
            this.trainAux(instance);
        }

        ++this.steps;
    }

    public void augment(Instance instance) {
        if (instance.hasStringLabel()) {
            int label = this.addLabel(instance.getStringLabel());
            instance.setGoldLabel(label);
        }

        this.augment(instance.getFeatureVector());
    }

    public void augment(FeatureVector x) {
        if (x.hasSparseVector()) {
            x.getSparseVector().addBias(this.bias);
        } else {
            x.setSparseVector(new SparseVector(this.bias));
        }

    }

    protected void expand(FeatureVector x) {
        int sparseFeatureSize = x.hasSparseVector() ? x.getSparseVector().maxIndex() + 1 : 0;
        int denseFeatureSize = x.hasDenseVector() ? x.getDenseVector().length : 0;
        int labelSize = this.getLabelSize();
        this.expand(sparseFeatureSize, denseFeatureSize, labelSize);
    }

    protected boolean expand(int sparseFeatureSize, int denseFeatureSize, int labelSize) {
        boolean b = this.weight_vector.expand(sparseFeatureSize, denseFeatureSize, labelSize);
        if (b && this.isL1Regularization()) {
            this.l1_regularizer.expand(sparseFeatureSize, denseFeatureSize, labelSize);
        }

        return b;
    }

    protected abstract void trainAux(Instance var1);

    public abstract void updateMiniBatch();

    protected abstract int getPredictedLabel(Instance var1);

    protected int getPredictedLabelHingeLoss(Instance instance) {
        float[] scores = instance.getScores();
        int y = instance.getGoldLabel();
        int var10002 = (int) scores[y]--;
        int yhat = this.argmax(scores);
        return yhat;
    }

    protected int getPredictedLabelRegression(Instance instance) {
        float[] scores = instance.getScores();
        int y = instance.getGoldLabel();
        return 1.0F <= scores[y] ? y : this.argmax(scores);
    }

    protected float[] getGradientsRegression(Instance instance) {
        float[] gradients = Arrays.copyOf(instance.getScores(), this.getLabelSize());
        MathUtils.multiply(gradients, -1);
        ++gradients[instance.getGoldLabel()];
        return gradients;
    }

    protected abstract float getLearningRate(int var1, boolean var2);

    protected int argmax(float[] scores) {
        int yhat = MLUtils.argmax(scores, this.getLabelSize());
        return scores[yhat] == 0.0F && yhat > 0 ? MLUtils.argmax(scores, yhat) : yhat;
    }

    public String toString(String type, String... args) {
        StringJoiner join = new StringJoiner(", ");
        join.add("learning rate = " + this.learning_rate);
        join.add("bias = " + this.bias);
        if (this.isL1Regularization()) {
            join.add("l1 = " + this.l1_regularizer.getRate());
        }

        String[] var4 = args;
        int var5 = args.length;

        for(int var6 = 0; var6 < var5; ++var6) {
            String arg = var4[var6];
            if (arg != null) {
                join.add(arg);
            }
        }

        return type + ": " + join.toString();
    }

    public float[] scores(FeatureVector x) {
        return this.scores(x, true);
    }

    public float[] scores(FeatureVector x, boolean augment) {
        if (augment) {
            this.augment(x);
        }

        return this.weight_vector.scores(x);
    }

    public void addScores(FeatureVector x, float[] scores) {
        this.weight_vector.addScores(x, scores);
    }
}