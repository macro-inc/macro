package com.macro.preprocess.parse.ie.credit;

import java.util.Collection;

import com.macro.preprocess.parse.PDFDOM;
import com.macro.preprocess.parse.ie.ExtractorWidget;
import com.macro.preprocess.parse.ie.Result;

public class NetWorth extends ExtractorWidget {
	
	public static final String name = "Net Worth";
	public static final CovenantType type = CovenantType.FINANCIAL;

	public NetWorth(PDFDOM dom, Collection<Result> masterResults) {
		super(dom, name, masterResults);
	}
	
	@Override
	public void run() {
		
	}
}
