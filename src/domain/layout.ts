import { DEFAULT_BUILDING_ID, getBuilding } from './building';
import { LAYOUT_SCHEMA_VERSION, type ID, type Layout, type RoomSettings } from './types';
import { createId, nowIso } from '@/lib/id';

export function defaultRooms(buildingId: string = DEFAULT_BUILDING_ID): Record<string, RoomSettings> {
  return Object.fromEntries(getBuilding(buildingId).spec.rooms.map((r) => [r.id, { lightsOn: true }]));
}

/** A new, empty hang plan for the default building. Backends may replace the id. */
export function createEmptyLayout(ownerId: ID, name: string): Layout {
  const now = nowIso();
  return {
    id: createId('lay'),
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    ownerId,
    name,
    buildingId: DEFAULT_BUILDING_ID,
    artworks: [],
    wallPaint: {},
    rooms: defaultRooms(),
    createdAt: now,
    updatedAt: now,
  };
}
