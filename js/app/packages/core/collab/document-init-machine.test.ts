import { describe, expect, it } from 'vitest';
import { DocInitMachine } from './document-init-machine';

describe('DocInitMachine', () => {
  describe('starting phase', () => {
    it('starts clean at rank 0 when wasDirty=false', () => {
      const m = DocInitMachine.create(false);
      expect(m.currentPhase()).toEqual({ mode: 'clean', appliedRank: 0 });
    });

    it('starts dirty awaiting when wasDirty=true', () => {
      const m = DocInitMachine.create(true);
      expect(m.currentPhase()).toEqual({ mode: 'dirty', phase: 'awaiting' });
    });
  });

  describe('clean mode', () => {
    it('cascade: optimistic -> s3 -> dss converges to synced', () => {
      const m = DocInitMachine.create(false);
      expect(m.receive('optimistic')).toBe('apply');
      expect(m.currentPhase()).toEqual({ mode: 'clean', appliedRank: 1 });
      expect(m.receive('s3')).toBe('apply');
      expect(m.currentPhase()).toEqual({ mode: 'clean', appliedRank: 2 });
      expect(m.receive('dss')).toBe('apply');
      expect(m.currentPhase()).toEqual({ mode: 'clean', appliedRank: 3 });
    });

    it('lower-or-equal-authority kinds are ignored once a higher one is applied', () => {
      const m = DocInitMachine.create(false);
      m.receive('s3'); // rank 2
      // both lower (rank 1) and equal (rank 2) get dropped
      expect(m.receive('optimistic')).toBe('ignore');
      expect(m.receive('local')).toBe('ignore');
      expect(m.receive('s3')).toBe('ignore');
      expect(m.currentPhase()).toEqual({ mode: 'clean', appliedRank: 2 });
    });

    it('requested is meaningless in clean mode, always ignored', () => {
      const m = DocInitMachine.create(false);
      expect(m.receive('requested')).toBe('ignore');
      expect(m.currentPhase()).toEqual({ mode: 'clean', appliedRank: 0 });
    });

    it('once synced, everything is ignored', () => {
      const m = DocInitMachine.create(false);
      m.receive('dss');
      for (const kind of [
        'optimistic',
        'local',
        's3',
        'dss',
        'requested',
      ] as const) {
        expect(m.receive(kind)).toBe('ignore');
      }
      expect(m.currentPhase()).toEqual({ mode: 'clean', appliedRank: 3 });
    });
  });

  describe('dirty mode', () => {
    it('only local transitions out of awaiting; all shallow snapshots are dropped', () => {
      const m = DocInitMachine.create(true);
      for (const kind of ['optimistic', 's3', 'dss', 'requested'] as const) {
        expect(m.receive(kind)).toBe('ignore');
      }
      expect(m.currentPhase()).toEqual({ mode: 'dirty', phase: 'awaiting' });
      expect(m.receive('local')).toBe('applyThenRequestDelta');
      expect(m.currentPhase()).toEqual({
        mode: 'dirty',
        phase: 'awaitingDelta',
      });
    });

    it('only requested transitions out of awaitingDelta', () => {
      const m = DocInitMachine.create(true);
      m.receive('local');
      for (const kind of ['optimistic', 'local', 's3', 'dss'] as const) {
        expect(m.receive(kind)).toBe('ignore');
      }
      expect(m.currentPhase()).toEqual({
        mode: 'dirty',
        phase: 'awaitingDelta',
      });
      expect(m.receive('requested')).toBe('apply');
      expect(m.currentPhase()).toEqual({ mode: 'dirty', phase: 'synced' });
    });

    it('full sequence: shallow snapshots arriving before AND during catch-up are dropped', () => {
      const m = DocInitMachine.create(true);
      expect(m.receive('optimistic')).toBe('ignore'); // early arrival
      expect(m.receive('dss')).toBe('ignore'); // early arrival
      expect(m.receive('local')).toBe('applyThenRequestDelta');
      expect(m.receive('s3')).toBe('ignore'); // during catch-up
      expect(m.receive('dss')).toBe('ignore'); // during catch-up
      expect(m.receive('requested')).toBe('apply');
      expect(m.currentPhase()).toEqual({ mode: 'dirty', phase: 'synced' });
    });
  });
});
