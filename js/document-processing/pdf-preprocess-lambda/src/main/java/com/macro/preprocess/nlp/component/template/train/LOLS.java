package com.macro.preprocess.nlp.component.template.train;

import com.macro.preprocess.nlp.common.random.XORShiftRandom;

import java.util.Random;

public class LOLS {
    private int fixed_stage;
    private double decaying_rate;
    private double gold_probability;
    private Random random;

    public LOLS(int fixedStage, double decayingRate) {
        this.init(fixedStage, decayingRate);
    }

    private void init(int fixedStage, double decayingRate) {
        this.fixed_stage = fixedStage;
        this.decaying_rate = decayingRate;
        this.gold_probability = 1.0;
        this.random = new XORShiftRandom(9L);
    }

    public void updateGoldProbability() {
        if (this.fixed_stage <= 0) {
            this.gold_probability *= this.decaying_rate;
        } else {
            --this.fixed_stage;
        }

    }

    public double getGoldProbability() {
        return this.gold_probability;
    }

    public boolean chooseGold() {
        return this.gold_probability > 0.0 && (this.gold_probability >= 1.0 || this.gold_probability > this.random.nextDouble());
    }

    public String toString() {
        return String.format("LOLS: fixed = %d, decaying rate = %s", this.fixed_stage, this.decaying_rate);
    }
}