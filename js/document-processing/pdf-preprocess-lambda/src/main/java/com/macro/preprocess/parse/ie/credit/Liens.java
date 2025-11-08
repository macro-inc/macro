package com.macro.preprocess.parse.ie.credit;

import java.util.Collection;
import java.util.NavigableSet;
import java.util.TreeSet;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.parse.PDFDOM;
import com.macro.preprocess.parse.ie.ExtractorWidget;
import com.macro.preprocess.parse.ie.Result;

public class Liens extends ExtractorWidget {
	
	public static final String name = "Liens";
	public static final CovenantType type = CovenantType.LIENS;

	public Liens(PDFDOM dom, Collection<Result> masterResults) {
		super(dom, name, masterResults);
	}

	@Override
	public void run() {
		for (SSection s : this.getDom().getAllSections()) {
			if (s.getSectionTitleString().toLowerCase().contains("lien")) {
				for (SSection sub : s.getSubsections()) {
					String xml = sub.getAllSubsectionNumericXML();
					if (xml.isEmpty()) continue;
					NavigableSet<PhysicalComponent> set = new TreeSet<PhysicalComponent>();
					set.addAll(sub.getTboxes());
					Result res = new Result(set, sub.getFullyQualifiedSectionNumber() + " " + sub.getSectionTitleString(), xml, sub, type);
					this.addResult(res);
				}
			}
		}
	}
}
