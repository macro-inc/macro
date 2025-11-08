package com.macro.preprocess.parse.util;

import java.util.Iterator;
import java.util.NavigableSet;
import java.util.TreeSet;

public class PeekIterator<T> implements Iterator<T> {
	
	NavigableSet<T> col;
	
	public PeekIterator(NavigableSet<T> src) {
		col = new TreeSet<T>(src);
	}

	@Override
	public boolean hasNext() {
		return !col.isEmpty();
	}

	@Override
	public T next() {
		return col.pollFirst();
	}
	
	public T peekNext() {
		return col.first();
	}
	
	public void advance() {
		col.pollFirst();
	}
}
