package com.macro.preprocess.utils;

import org.apache.commons.math3.util.FastMath;

public class MathUtils {
    public static double DOUBLE_NEGATIVE_MIN = Double.MIN_VALUE;

    private MathUtils() {
    }

    public static double average(double... array) {
        double sum = 0.0;
        double[] var3 = array;
        int var4 = array.length;

        for(int var5 = 0; var5 < var4; ++var5) {
            double d = var3[var5];
            sum += d;
        }

        return sum / (double)array.length;
    }

    public static double variance(double... array) {
        double avg = average(array);
        double sum = 0.0;
        double[] var5 = array;
        int var6 = array.length;

        for(int var7 = 0; var7 < var6; ++var7) {
            double d = var5[var7];
            sum += sq(d - avg);
        }

        return sum / (double)(array.length - 1);
    }

    public static double stdev(double... array) {
        return Math.sqrt(variance(array));
    }

    public static int ceil(double d) {
        return (int)Math.ceil(d);
    }

    public static double divide(int numerator, int denominator) {
        return (double)numerator / (double)denominator;
    }

    public static double divide(long numerator, long denominator) {
        return (double)numerator / (double)denominator;
    }

    public static double divide(long numerator, double denominator) {
        return (double)numerator / denominator;
    }

    public static double accuracy(int correct, int total) {
        return 100.0 * (double)correct / (double)total;
    }

    public static double reciprocal(int number) {
        return divide(1, number);
    }

    public static double pow(double base, int exponent) {
        if (exponent == 0) {
            return 1.0;
        } else if (exponent == 1) {
            return base;
        } else if (exponent == -1) {
            return 1.0 / base;
        } else {
            boolean negative;
            if (exponent < 0) {
                negative = true;
                exponent = -exponent;
            } else {
                negative = false;
            }

            double mod = exponent % 2 == 0 ? 1.0 : base;
            double p = base;

            for(exponent /= 2; exponent > 0; exponent /= 2) {
                p *= p;
            }

            mod *= p;
            return negative ? 1.0 / mod : mod;
        }
    }

    public static long sq(long l) {
        return l * l;
    }

    public static double sq(double d) {
        return d * d;
    }

    public static float sq(float f) {
        return f * f;
    }

    public static int signum(long a) {
        return a > 0L ? 1 : (a < 0L ? -1 : 0);
    }

    public static int signum(double d) {
        return (int)Math.signum(d);
    }

    public static double getF1(double precision, double recall) {
        return precision + recall == 0.0 ? 0.0 : 2.0 * precision * recall / (precision + recall);
    }

    public static double getAccuracy(int correct, int total) {
        return 100.0 * (double)correct / (double)total;
    }

    public static double sum(double[] vector) {
        double sum = 0.0;
        double[] var3 = vector;
        int var4 = vector.length;

        for(int var5 = 0; var5 < var4; ++var5) {
            double d = var3[var5];
            sum += d;
        }

        return sum;
    }

    public static double sum(float[] vector) {
        double sum = 0.0;
        float[] var3 = vector;
        int var4 = vector.length;

        for(int var5 = 0; var5 < var4; ++var5) {
            double d = (double)var3[var5];
            sum += d;
        }

        return sum;
    }

    public static double sumOfSquares(double[] vector) {
        double sum = 0.0;
        double[] var3 = vector;
        int var4 = vector.length;

        for(int var5 = 0; var5 < var4; ++var5) {
            double d = var3[var5];
            sum += sq(d);
        }

        return sum;
    }

    public static void multiply(double[] array, double multiplier) {
        int size = array.length;

        for(int i = 0; i < size; ++i) {
            array[i] *= multiplier;
        }

    }

    public static void multiply(float[] array, int multiplier) {
        int size = array.length;

        for(int i = 0; i < size; ++i) {
            array[i] *= (float)multiplier;
        }

    }

    public static void multiply(float[] array, double multiplier) {
        int size = array.length;

        for(int i = 0; i < size; ++i) {
            array[i] = (float)((double)array[i] * multiplier);
        }

    }

    public static void add(float[] array1, float[] array2) {
        int size = array1.length;

        for(int i = 0; i < size; ++i) {
            array1[i] += array2[i];
        }

    }

    public static double sigmoid(double d) {
        return 1.0 / (1.0 + FastMath.exp(-d));
    }

    public static boolean isPrimeNumber(long n) {
        if (n < 2L) {
            return false;
        } else if (n != 2L && n != 3L) {
            if (n % 2L != 0L && n % 3L != 0L) {
                long sqrt = (long)Math.sqrt((double)n) + 1L;

                for(long i = 6L; i <= sqrt; i += 6L) {
                    if (n % (i - 1L) == 0L || n % (i + 1L) == 0L) {
                        return false;
                    }
                }

                return true;
            } else {
                return false;
            }
        } else {
            return true;
        }
    }

    public static long nextPrimeNumber(long n) {
        while(n < Long.MAX_VALUE) {
            if (isPrimeNumber(n)) {
                return n;
            }

            ++n;
        }

        return -1L;
    }

    public static int divisor(int a, int b) {
        return a < 0 ? (a % b + b) % b : a % b;
    }

    public static int modulus(int a, int b) {
        return (a % b + b) % b;
    }

    public static int modulus(long a, int b) {
        return ((int)(a % (long)b) + b) % b;
    }

    public static double cosineSimilarity(float[] f1, float[] f2) {
        float num = 0.0F;
        float den1 = 0.0F;
        float den2 = 0.0F;

        for(int i = 0; i < f1.length; ++i) {
            num += f1[i] * f2[i];
            den1 += sq(f1[i]);
            den2 += sq(f2[i]);
        }

        return (double)num / (Math.sqrt((double)den1) * Math.sqrt((double)den2));
    }
}
