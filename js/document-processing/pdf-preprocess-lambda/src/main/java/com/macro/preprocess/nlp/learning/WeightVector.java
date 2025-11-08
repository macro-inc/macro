package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.nlp.learning.util.activation.ActivationFunction;
import com.macro.preprocess.nlp.learning.util.initialization.WeightGenerator;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;

public class WeightVector implements Serializable {
    private static final long serialVersionUID = -3283251983046316463L;
    private ActivationFunction activation_function;
    private MajorVector sparse_weight_vector;
    private MajorVector dense_weight_vector;

    public WeightVector() {
        this((ActivationFunction)null);
    }

    public WeightVector(ActivationFunction function) {
        this.setSparseWeightVector(new ColumnMajorVector());
        this.setDenseWeightVector(new RowMajorVector());
        this.setActivationFunction(function);
    }

    public MajorVector getMajorVector(boolean sparse) {
        return sparse ? this.sparse_weight_vector : this.dense_weight_vector;
    }

    public MajorVector getSparseWeightVector() {
        return this.sparse_weight_vector;
    }

    public void setSparseWeightVector(MajorVector vector) {
        this.sparse_weight_vector = vector;
    }

    public MajorVector getDenseWeightVector() {
        return this.dense_weight_vector;
    }

    public void setDenseWeightVector(MajorVector vector) {
        this.dense_weight_vector = vector;
    }

    public ActivationFunction getActivationFunction() {
        return this.activation_function;
    }

    public void setActivationFunction(ActivationFunction function) {
        this.activation_function = function;
    }

    public boolean hasActivationFunction() {
        return this.activation_function != null;
    }

    public int getLabelSize() {
        return this.sparse_weight_vector.getLabelSize();
    }

    public boolean expand(int sparseFeatureSize, int denseFeatureSize, int labelSize) {
        return this.expand(sparseFeatureSize, denseFeatureSize, labelSize, (WeightGenerator)null);
    }

    public boolean expand(int sparseFeatureSize, int denseFeatureSize, int labelSize, WeightGenerator generator) {
        boolean b = false;
        b |= this.sparse_weight_vector.expand(labelSize, sparseFeatureSize, generator);
        b |= this.dense_weight_vector.expand(labelSize, denseFeatureSize, generator);
        return b;
    }

    public WeightVector createZeroVector() {
        WeightVector vector = new WeightVector(this.activation_function);
        vector.setSparseWeightVector(this.sparse_weight_vector.createZeroVector());
        vector.setDenseWeightVector(this.dense_weight_vector.createZeroVector());
        return vector;
    }

    public int countNonZeroWeights() {
        return this.sparse_weight_vector.countNonZeroWeights() + this.dense_weight_vector.countNonZeroWeights();
    }

    public List<int[]> getTopFeatureCombinations(FeatureVector x, int gold, int yhat) {
        List<SparsePrediction> pos = new ArrayList();
        List<int[]> list = new ArrayList();
        SparseVector v = x.getSparseVector();
        Iterator var9 = v.iterator();

        SparsePrediction p;
        while(var9.hasNext()) {
            SparseItem t = (SparseItem)var9.next();
            float f = this.sparse_weight_vector.get(gold, t.getIndex()) - this.sparse_weight_vector.get(yhat, t.getIndex());
            p = new SparsePrediction(t.getIndex(), f);
            if (f > 0.0F) {
                pos.add(p);
            }
        }

        Collections.sort(pos, Collections.reverseOrder());
        if (!pos.isEmpty()) {
            p = (SparsePrediction)pos.get(0);

            for(int i = 1; i < 3 && i < pos.size(); ++i) {
                list.add(new int[]{p.getLabel(), ((SparsePrediction)pos.get(i)).getLabel()});
            }
        }

        return list;
    }

    public float[] scores(FeatureVector x) {
        float[] scores = new float[this.getLabelSize()];
        this.addScores(x, scores);
        return scores;
    }

    public void addScores(FeatureVector x, float[] scores) {
        if (x.hasSparseVector()) {
            this.sparse_weight_vector.addScores(x.getSparseVector(), scores);
        }

        if (x.hasDenseVector()) {
            this.dense_weight_vector.addScores(x.getDenseVector(), scores);
        }

        if (this.hasActivationFunction()) {
            this.activation_function.apply(scores);
        }

    }
}