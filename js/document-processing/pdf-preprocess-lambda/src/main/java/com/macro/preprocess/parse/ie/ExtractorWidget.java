package com.macro.preprocess.parse.ie;

import java.util.Collection;
import java.util.NavigableSet;
import java.util.TreeSet;

import com.macro.preprocess.parse.PDFDOM;

public abstract class ExtractorWidget implements Runnable {
	
	private NavigableSet<Result> results;
	private Collection<Result> masterResults;
	private ClauseType ctype;
	private String name;
	public PDFDOM dom;
	
	public ExtractorWidget(PDFDOM dom, String name, Collection<Result> masterResults) {
		this.dom = dom;
		this.masterResults = masterResults;
		this.name = name;
		this.results = new TreeSet<Result>();
	}
	
	public String getName() {
		return this.name;
	}
	public boolean isEmpty() {
		return this.results.isEmpty();
	}
	public PDFDOM getDom() {
		return this.dom;
	}
	public ClauseType getClause() {
		return this.ctype;
	}
	public void addResult(Result r) {
		this.results.add(r);
		this.masterResults.add(r);
	}
	public NavigableSet<Result> getResults() {
		return this.results;
	}
}
