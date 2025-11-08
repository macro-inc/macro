package com.macro.preprocess.component.logical;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import com.macro.preprocess.component.*;
import org.javatuples.*;

public class Figure extends LogicalComponent {

	protected SSection owningSection;
	protected Set<PhysicalComponent> physicalMakeup;
	protected List<Reference<Figure>> referenceMentions;

	public Figure() {
		this.physicalMakeup = new HashSet<PhysicalComponent>(physicalMakeup);
		this.referenceMentions = new ArrayList<Reference<Figure>>();
	}

	public Figure(SSection owningSection, Set<PhysicalComponent> physicalMakeup, List<Reference<Figure>> referenceMentions) {
		this.owningSection = owningSection;
		this.physicalMakeup = physicalMakeup;
		this.referenceMentions = referenceMentions;
	}

	@Override
	public SSection getSection() {
		return this.owningSection;
	}

	@Override
	public void setSection(SSection section) {
		assert((this.owningSection == null || this.owningSection.equals(section)));
		section.figures.add(this);
		this.owningSection = section;
	}

	public Set<PhysicalComponent> getPhysicalMakeup() {
		return physicalMakeup;
	}

	public List<Reference<Figure>> getReferenceMentions() {
		return referenceMentions;
	}

	public void setPhysicalMakeup(Set<PhysicalComponent> physicalMakeup) {
		this.physicalMakeup = physicalMakeup;
	}

	public void setReferenceMentions(List<Reference<Figure>> referenceMentions) {
		this.referenceMentions = referenceMentions;
	}

	public void addPhysicalComponent(PhysicalComponent physical) {
		this.physicalMakeup.add(physical);
		physical.setLogicalOwner(this);
	}

	/**
	 * @return ((x1, y1),(x2,y2))
	 */
	public Pair<Pair<Float, Float>, Pair<Float, Float>> getBoundingBox() {
		float minX = 0;
		float minY = 0;
		float maxX = 0;
		float maxY = 0;
		for (PhysicalComponent pc : this.physicalMakeup) {
			float x1 = pc.getX();
			float x2 = pc.getX() + pc.getWidth();
			float y1 = pc.getY();
			float y2 = pc.getY() + pc.getHeight();
			minX = Math.min(minX, x1);
			maxX = Math.max(maxX, x2);
			minY = Math.min(minY, y1);
			maxY = Math.max(maxY, y2);
		}
		Pair<Float, Float> top = new Pair<Float, Float>(minX, minY);
		Pair<Float, Float> bot = new Pair<Float, Float>(maxX, maxY);
		return new Pair<Pair<Float, Float>, Pair<Float, Float>>(top, bot);
	}
}
