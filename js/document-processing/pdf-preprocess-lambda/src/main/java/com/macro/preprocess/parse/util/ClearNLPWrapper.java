package com.macro.preprocess.parse.util;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;

import com.macro.preprocess.nlp.NLPDecoder;
import com.macro.preprocess.utils.MathUtils;
import com.macro.preprocess.nlp.node.NLPNode;

public class ClearNLPWrapper {
	//private static String CONFIG = "nlp4j-data/config.xml";
	private static NLPDecoder d = new NLPDecoder();
	
	/**
	 * Returns true if a definition is one that is not providing an actual definition
	 * but rather on that is referencing some other section that has the required element
	 * @param s
	 * @return
	 */
	public static boolean isReferentialDefinition(String s) {
		if (s.length() > 100) return false;
		float[] vector = getVector(s);
		if ((vector) == null) return false;
		String[] keywords = new String[] {
				"has the specified in section hereof",
				"is as defined in",
				"in the introductory paragraph",
				"defined in article",
				"set forth in",
				"as specified in"
				};
		List<Double> sims = new ArrayList<Double>();
		for (String keyword : keywords) {
			sims.add(MathUtils.cosineSimilarity(getVector(keyword), vector));
		}
		double d = sims.stream().mapToDouble(a -> a).average().getAsDouble();
		return false;
	}
	
	/**
	 * Simple Bag-of-Words embedding
	 * @param s string
	 * @return the BoW embedding
	 */
	public static float[] getVector(String s) {
		List<float[]> fs = Arrays.asList(d.decode(s)).stream().map(n -> n.getWordEmbedding())
				.collect(Collectors.toList());
		float[] cum = null;
		int i = -1;
		while ((cum == null) && (i < fs.size() - 1)) {
			cum = fs.get(++i);
		}
		if (cum == null) return null;
		if (fs.size() > 1) {
			for (float[] f : fs.subList(i, fs.size())) {
				if (f != null) {
					MathUtils.add(cum, f);
				}
			}
		}
		return cum;
	}

	public static boolean containsMoney(String s) {
		for (NLPNode nn : d.decode(s)) {
			if (nn.getNamedEntityTag().contains("MONEY")) {
				return true;
			}
		}
		return false;
	}

	public static boolean containsRatioLiteral(SSection s) {
		String f1 = null;
		StringBuilder toret = new StringBuilder();
		for (TextBox t : s.getTboxes()) {
			for (PhysicalComponent p : t.getChildren()) {
				TextToken tt = (TextToken) p;
				String ratioParse = parseRatioString(tt.toString());
				if (ratioParse != null) {
					toret.append(ratioParse + "; ");
				}
				if (f1 != null) {
					if ((!isFloat(tt.toString()))
							&& (!(tt.toString().equals(":") || (tt.toString().toLowerCase().equals("to"))))) {
						f1 = null;
					}
				}
				if (isFloat(tt.toString())) {
					if (f1 != null) {
						toret.append(f1 + " to " + tt.toString() + "; ");
						f1 = null;
					} else {
						f1 = tt.toString();
					}
				}
			}
		}
		return (!toret.toString().isEmpty());
	}

	/**
	 * Parse "1.95:1.00"
	 * 
	 * @return
	 */
	private static String parseRatioString(String s) {
		if (!s.contains(":"))
			return null;
		String[] toks = s.split(":");
		if (toks.length != 2)
			return null;
		if ((!isFloat(toks[0])) || (!isFloat(toks[1]))) {
			return null;
		}
		return toks[0] + " to " + toks[1];
	}

	private static boolean isFloat(String s) {
		try {
			Float.parseFloat(s);
			return true;
		} catch (Exception e) {
			return false;
		}
	}
	
	public static long wordsToNum(String input) {
		boolean isValidInput = true;
	    long result = 0;
	    long finalResult = 0;
	    List<String> allowedStrings = Arrays.asList
	    (
	    "zero","one","two","three","four","five","six","seven",
	    "eight","nine","ten","eleven","twelve","thirteen","fourteen",
	    "fifteen","sixteen","seventeen","eighteen","nineteen","twenty",
	    "thirty","forty","fifty","sixty","seventy","eighty","ninety",
	    "hundred","thousand","million","billion","trillion"
	    );

	    if(input != null && input.length()> 0)
	    {
	        input = input.replaceAll("-", " ");
	        input = input.toLowerCase().replaceAll(" and", " ");
	        String[] splittedParts = input.trim().split("\\s+");

	        for(String str : splittedParts)
	        {
	            if(!allowedStrings.contains(str))
	            {
	                isValidInput = false;
	                break;
	            }
	        }
	        if(isValidInput)
	        {
	            for(String str : splittedParts)
	            {
	                if(str.equalsIgnoreCase("zero")) {
	                    result += 0;
	                }
	                else if(str.equalsIgnoreCase("one")) {
	                    result += 1;
	                }
	                else if(str.equalsIgnoreCase("two")) {
	                    result += 2;
	                }
	                else if(str.equalsIgnoreCase("three")) {
	                    result += 3;
	                }
	                else if(str.equalsIgnoreCase("four")) {
	                    result += 4;
	                }
	                else if(str.equalsIgnoreCase("five")) {
	                    result += 5;
	                }
	                else if(str.equalsIgnoreCase("six")) {
	                    result += 6;
	                }
	                else if(str.equalsIgnoreCase("seven")) {
	                    result += 7;
	                }
	                else if(str.equalsIgnoreCase("eight")) {
	                    result += 8;
	                }
	                else if(str.equalsIgnoreCase("nine")) {
	                    result += 9;
	                }
	                else if(str.equalsIgnoreCase("ten")) {
	                    result += 10;
	                }
	                else if(str.equalsIgnoreCase("eleven")) {
	                    result += 11;
	                }
	                else if(str.equalsIgnoreCase("twelve")) {
	                    result += 12;
	                }
	                else if(str.equalsIgnoreCase("thirteen")) {
	                    result += 13;
	                }
	                else if(str.equalsIgnoreCase("fourteen")) {
	                    result += 14;
	                }
	                else if(str.equalsIgnoreCase("fifteen")) {
	                    result += 15;
	                }
	                else if(str.equalsIgnoreCase("sixteen")) {
	                    result += 16;
	                }
	                else if(str.equalsIgnoreCase("seventeen")) {
	                    result += 17;
	                }
	                else if(str.equalsIgnoreCase("eighteen")) {
	                    result += 18;
	                }
	                else if(str.equalsIgnoreCase("nineteen")) {
	                    result += 19;
	                }
	                else if(str.equalsIgnoreCase("twenty")) {
	                    result += 20;
	                }
	                else if(str.equalsIgnoreCase("thirty")) {
	                    result += 30;
	                }
	                else if(str.equalsIgnoreCase("forty")) {
	                    result += 40;
	                }
	                else if(str.equalsIgnoreCase("fifty")) {
	                    result += 50;
	                }
	                else if(str.equalsIgnoreCase("sixty")) {
	                    result += 60;
	                }
	                else if(str.equalsIgnoreCase("seventy")) {
	                    result += 70;
	                }
	                else if(str.equalsIgnoreCase("eighty")) {
	                    result += 80;
	                }
	                else if(str.equalsIgnoreCase("ninety")) {
	                    result += 90;
	                }
	                else if(str.equalsIgnoreCase("hundred")) {
	                    result *= 100;
	                }
	                else if(str.equalsIgnoreCase("thousand")) {
	                    result *= 1000;
	                    finalResult += result;
	                    result=0;
	                }
	                else if(str.equalsIgnoreCase("million")) {
	                    result *= 1000000;
	                    finalResult += result;
	                    result=0;
	                }
	                else if(str.equalsIgnoreCase("billion")) {
	                    result *= 1000000000;
	                    finalResult += result;
	                    result=0;
	                }
	                else if(str.equalsIgnoreCase("trillion")) {
	                    result *= 1000000000000L;
	                    finalResult += result;
	                    result=0;
	                }
	            }

	            finalResult += result;
	            result=0;
	        }
	    }
	    if (!isValidInput) return -1;
	    return finalResult;
	}

	public static void main(String args[]) {
		ClearNLPWrapper.isReferentialDefinition(" have the set forth in Section 2.7 hereof");
		System.out.println("---");
		ClearNLPWrapper.isReferentialDefinition(" the period beginning on (and including) the sixth (6th) day");
		System.out.println("---");
		ClearNLPWrapper.isReferentialDefinition(" all federal, state, county, municipal and other governmental\n" + 
				"statutes.");
		System.out.println("---");
		ClearNLPWrapper.isReferentialDefinition(" have the set forth in the Security Instrument");
	}
	
}
