/**
 * Core domain model. These types are deliberately transport-agnostic so the
 * same shapes can be returned by the local prototype services today and by a
 * REST/GraphQL backend later.
 */

export type ID = string;
export type ISODate = string;

export interface User {
  id: ID;
  email: string;
  displayName: string;
  createdAt: ISODate;
}

/** The subset of a user that is safe to show to other users. */
export type PublicUser = Pick<User, 'id' | 'email' | 'displayName'>;

export type FrameStyle = 'none' | 'black' | 'white' | 'oak';

/**
 * A stand-in for a work that isn't available yet: a blank panel with editable
 * text, shown at the real size so the hang can be planned around it.
 */
export interface PlaceholderSpec {
  text: string;
}

/**
 * A work hung on a wall surface. Positions are in metres in surface space.
 * Either `assetId` (an uploaded image) or `placeholder` is set.
 */
export interface Artwork {
  id: ID;
  assetId?: ID;
  placeholder?: PlaceholderSpec;
  title: string;
  surfaceId: string;
  /** Horizontal distance (m) from the surface's left edge to the artwork centre. */
  u: number;
  /** Height (m) from the floor to the artwork centre. */
  v: number;
  widthCm: number;
  heightCm: number;
  frame: FrameStyle;
}

/**
 * A movable gallery wall, 30 cm thick, standing on the floor. Both faces can
 * be hung and painted; their surface ids are `<id>:a` and `<id>:b`.
 */
export interface Partition {
  id: ID;
  /** Plan centre, metres. */
  x: number;
  z: number;
  /** Rotation about the vertical axis, radians. */
  rotation: number;
  lengthM: number;
  heightM: number;
}

/**
 * A 3D object shown as a photo standing on a plinth. The photo always turns
 * to face the viewer, which reads as a solid object when walking around.
 */
export interface GalleryObject {
  id: ID;
  assetId: ID;
  title: string;
  x: number;
  z: number;
  /** Real-world size of the object itself (width comes from the photo's proportions). */
  heightCm: number;
  widthCm: number;
  /** Height of the plinth it stands on; 0 = straight on the floor. */
  plinthHeightCm: number;
  plinthColor: string;
}

export interface RoomSettings {
  lightsOn: boolean;
}

export const LAYOUT_SCHEMA_VERSION = 1;

export interface Layout {
  id: ID;
  schemaVersion: number;
  ownerId: ID;
  name: string;
  /** Which building model this layout was designed for. */
  buildingId: string;
  artworks: Artwork[];
  /** surfaceId -> hex colour (#rrggbb). Missing entries use the default white. */
  wallPaint: Record<string, string>;
  rooms: Record<string, RoomSettings>;
  /** Optional so layouts saved before these existed still load. */
  partitions?: Partition[];
  objects?: GalleryObject[];
  thumbnailAssetId?: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface LayoutSummary {
  id: ID;
  name: string;
  ownerId: ID;
  ownerName: string;
  artworkCount: number;
  thumbnailAssetId?: ID;
  updatedAt: ISODate;
}

export type SharePermission = 'view';

export interface Share {
  id: ID;
  layoutId: ID;
  ownerId: ID;
  recipientId: ID;
  recipientEmail: string;
  permission: SharePermission;
  createdAt: ISODate;
}

/** Where a speech-bubble note is pinned. */
export type NoteAnchor =
  | { kind: 'surface'; surfaceId: string; u: number; v: number }
  | {
      kind: 'artwork';
      artworkId: ID;
      /** Offset (m) from the artwork centre. */
      du: number;
      dv: number;
      /** Fallback position if the artwork is later removed. */
      surfaceId: string;
      u: number;
      v: number;
    };

export interface Note {
  id: ID;
  layoutId: ID;
  authorId: ID;
  authorName: string;
  text: string;
  anchor: NoteAnchor;
  createdAt: ISODate;
}

export interface Asset {
  id: ID;
  ownerId: ID;
  mimeType: string;
  /** Pixel dimensions of the stored image. */
  width: number;
  height: number;
  byteSize: number;
  createdAt: ISODate;
}
