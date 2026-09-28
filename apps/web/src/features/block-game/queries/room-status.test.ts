import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@app/features/property/identifiers';
import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameStatus } from '../core/status';
import { gameStatusFromOption, publishRoomStatus } from './room-status';

const { getEntityProperties, setEntityProperty } = vi.hoisted(() => ({
  getEntityProperties: vi.fn(),
  setEntityProperty: vi.fn(),
}));
vi.mock('@service-properties/client', () => ({
  propertiesServiceClient: { getEntityProperties, setEntityProperty },
}));

const stored = (optionId: string | undefined) =>
  okAsync({
    entity_id: 'room-1',
    properties:
      optionId === undefined
        ? []
        : [
            {
              property: { property_definition_id: SYSTEM_PROPERTY_IDS.STATUS },
              value: { type: 'SelectOption', value: [optionId] },
            },
          ],
  });

beforeEach(() => {
  getEntityProperties.mockReset();
  setEntityProperty.mockReset();
  getEntityProperties.mockReturnValue(stored(undefined));
});

describe('room status', () => {
  it('publishes each state as the document Status and reads it back', async () => {
    setEntityProperty.mockReturnValue(okAsync(undefined));
    const statuses: GameStatus[] = ['waiting', 'in_progress', 'finished'];
    for (const status of statuses) {
      expect(await publishRoomStatus('room-1', status)).toBe(true);
    }

    const options = setEntityProperty.mock.calls.map(([request]) => {
      expect(request).toMatchObject({
        entity_type: 'DOCUMENT',
        entity_id: 'room-1',
        property_id: SYSTEM_PROPERTY_IDS.STATUS,
      });
      return request.body.value.option_id as string;
    });
    expect(options).toEqual([
      PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
      PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      PROPERTY_OPTION_IDS.STATUS.COMPLETED,
    ]);
    expect(options.map(gameStatusFromOption)).toEqual(statuses);
  });

  it('leaves a status another client already stored', async () => {
    getEntityProperties.mockReturnValue(
      stored(PROPERTY_OPTION_IDS.STATUS.COMPLETED)
    );
    expect(await publishRoomStatus('room-1', 'finished')).toBe(true);
    expect(setEntityProperty).not.toHaveBeenCalled();

    setEntityProperty.mockReturnValue(okAsync(undefined));
    expect(await publishRoomStatus('room-1', 'in_progress')).toBe(true);
    expect(setEntityProperty).toHaveBeenCalledTimes(1);
  });

  it('reports a failed write and ignores statuses a room never sets', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setEntityProperty.mockReturnValue(errAsync(new Error('offline')));
    expect(await publishRoomStatus('room-1', 'finished')).toBe(false);
    expect(gameStatusFromOption(undefined)).toBeUndefined();
    expect(gameStatusFromOption('some-custom-option')).toBeUndefined();
  });
});
