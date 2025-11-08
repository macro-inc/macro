package com.macro.preprocess.parse.ie;

import java.util.NavigableSet;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.SSection;

/**
 * An entry returned by an extractor.
 * @author Jacob
 *
 */
public class Result implements Comparable<Result>{
	private NavigableSet<PhysicalComponent> sources;
	private String key;
	private ClauseType ctype;
	private String value;
	private SSection section;
		
	public Result(NavigableSet<PhysicalComponent> sources, String key, String value, SSection section, ClauseType ctype) {
		this.sources = sources;
		this.key = key;
		this.value = value;
		this.section = section;
		this.ctype = ctype;
	}
	
	public ClauseType getType() {
		return this.ctype;
	}

	public NavigableSet<PhysicalComponent> getSources() {
		return sources;
	}

	public String getKey() {
		return key;
	}

	public String getValue() {
		return value;
	}

	public int getPageNo() {
		if (this.sources == null) return 0;
		if (this.sources.isEmpty()) return 0;
		return this.sources.first().getPageNum();
	}

	public SSection getSection() {
		return section;
	}

	public void setKey(String key) {
		this.key = key;
	}

	public void setValue(String value) {
		this.value = value;
	}

	public void setSection(SSection section) {
		this.section = section;
	}

	@Override
	public int compareTo(Result o) {
		return (this.sources.first().compareTo(o.sources.first()));
	}
}
