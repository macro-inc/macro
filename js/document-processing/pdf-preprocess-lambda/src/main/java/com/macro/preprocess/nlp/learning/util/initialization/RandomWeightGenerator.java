package com.macro.preprocess.nlp.learning.util.initialization;

import com.macro.preprocess.nlp.common.random.XORShiftRandom;

import java.util.Random;

public class RandomWeightGenerator implements WeightGenerator {
    private static final long serialVersionUID = 4923093894775449475L;
    private float lower_bound;
    private float upper_bound;
    private Random rand;

    public RandomWeightGenerator(float lowerBound, float upperBound) {
        this.lower_bound = lowerBound;
        this.upper_bound = upperBound;
        this.rand = new XORShiftRandom(9L);
    }

    public float next() {
        return this.lower_bound + (this.upper_bound - this.lower_bound) * this.rand.nextFloat();
    }
}
