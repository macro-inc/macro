package com.macro.preprocess.nlp.learning.optimization;

import com.macro.preprocess.nlp.learning.*;

import java.util.Iterator;

public abstract class StochasticGradientDescent extends OnlineOptimizer {
    private static final long serialVersionUID = -531288798885524823L;

    public StochasticGradientDescent(WeightVector vector, float learningRate, float bias) {
        this(vector, learningRate, bias, (Regularizer)null);
    }

    public StochasticGradientDescent(WeightVector vector, float learningRate, float bias, Regularizer l1) {
        super(vector, learningRate, bias, l1);
    }

    protected void trainClassification(Instance instance) {
        FeatureVector x = instance.getFeatureVector();
        int gold = instance.getGoldLabel();
        int yhat = instance.getPredictedLabel();
        Iterator var5 = x.getSparseVector().iterator();

        while(var5.hasNext()) {
            SparseItem xi = (SparseItem)var5.next();
            this.updateWeight(gold, xi.getIndex(), xi.getValue(), true);
            this.updateWeight(yhat, xi.getIndex(), -xi.getValue(), true);
        }

        if (x.hasDenseVector()) {
            float[] d = x.getDenseVector();

            int xi;
            for(xi = 0; xi < d.length; ++xi) {
                this.updateWeight(gold, xi, d[xi], false);
            }

            for(xi = 0; xi < d.length; ++xi) {
                this.updateWeight(yhat, xi, -d[xi], false);
            }
        }

    }

    protected void trainRegression(Instance instance, float[] gradients) {
        FeatureVector x = instance.getFeatureVector();
        Iterator var4 = x.getSparseVector().iterator();

        int i;
        while(var4.hasNext()) {
            SparseItem xi = (SparseItem)var4.next();

            for(i = 0; i < gradients.length; ++i) {
                this.updateWeight(i, xi.getIndex(), gradients[i] * xi.getValue(), true);
            }
        }

        if (x.hasDenseVector()) {
            float[] d = x.getDenseVector();

            for(int y = 0; y < gradients.length; ++y) {
                for(i = 0; i < d.length; ++i) {
                    this.updateWeight(y, i, gradients[y] * d[i], false);
                }
            }
        }

    }

    protected void updateWeight(int y, int xi, float gradient, boolean sparse) {
        MajorVector weights = this.weight_vector.getMajorVector(sparse);
        int index = weights.indexOf(y, xi);
        float learningRate = this.getLearningRate(index, sparse);
        if (this.isL1Regularization()) {
            this.l1_regularizer.updateWeight(index, gradient, learningRate, this.steps, sparse);
        } else {
            weights.add(index, gradient * learningRate);
        }

    }
}