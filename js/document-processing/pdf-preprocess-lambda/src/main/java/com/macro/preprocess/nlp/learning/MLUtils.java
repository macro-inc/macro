package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.utils.DSUtils;
import it.unimi.dsi.fastutil.ints.IntCollection;
import it.unimi.dsi.fastutil.ints.IntIterator;
import org.apache.commons.math3.util.FastMath;

public class MLUtils {
    public MLUtils() {
    }

    public static void softmax(float[] scores) {
        float sum = 0.0F;

        int i;
        for(i = 0; i < scores.length; ++i) {
            scores[i] = (float) FastMath.exp((double)scores[i]);
            sum += scores[i];
        }

        for(i = 0; i < scores.length; ++i) {
            scores[i] /= sum;
        }

    }

    public static int argmax(float[] scores) {
        return argmax(scores, scores.length);
    }

    public static int argmax(float[] scores, int size) {
        int maxIndex = 0;
        double maxValue = (double)scores[maxIndex];

        for(int i = 1; i < size; ++i) {
            if (maxValue < (double)scores[i]) {
                maxIndex = i;
                maxValue = (double)scores[i];
            }
        }

        return maxIndex;
    }

    public static int argmax(float[] scores, IntCollection labels) {
        if (labels != null && !labels.isEmpty()) {
            float maxValue = -3.4028235E38F;
            int maxIndex = -1;
            IntIterator var4 = labels.iterator();

            while(var4.hasNext()) {
                int i = (Integer)var4.next();
                if (maxValue < scores[i]) {
                    maxIndex = i;
                    maxValue = scores[i];
                }
            }

            return maxIndex;
        } else {
            return argmax(scores);
        }
    }

    public static int[] argmax2(float[] scores) {
        return argmax2(scores, scores.length);
    }

    public static int[] argmax2(float[] scores, int size) {
        if (size < 2) {
            return new int[]{0, -1};
        } else {
            int[] max = new int[]{0, 1};
            if (scores[0] < scores[1]) {
                max[0] = 1;
                max[1] = 0;
            }

            for(int i = 2; i < size; ++i) {
                if (scores[max[0]] < scores[i]) {
                    max[1] = max[0];
                    max[0] = i;
                } else if (scores[max[1]] < scores[i]) {
                    max[1] = i;
                }
            }

            return max;
        }
    }

    public static int[] argmax2(float[] scores, IntCollection labels) {
        if (labels != null && !labels.isEmpty()) {
            IntIterator it = labels.iterator();
            if (labels.size() < 2) {
                return new int[]{it.nextInt(), -1};
            } else {
                int[] max = new int[]{it.nextInt(), it.nextInt()};
                if (scores[max[0]] < scores[max[1]]) {
                    DSUtils.swap(max, 0, 1);
                }

                while(it.hasNext()) {
                    int i = it.nextInt();
                    if (scores[max[0]] < scores[i]) {
                        max[1] = max[0];
                        max[0] = i;
                    } else if (scores[max[1]] < scores[i]) {
                        max[1] = i;
                    }
                }

                return max;
            }
        } else {
            return argmax2(scores);
        }
    }
}