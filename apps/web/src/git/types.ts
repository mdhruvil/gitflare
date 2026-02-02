import type { GitObjectType } from "./object";

/**
 * Object metadata for batch fetching during upload-pack.
 * Contains all info needed to locate and read an object from R2 storage.
 */
export type ObjectMetadata = {
  oid: string;
  type: GitObjectType;
  packfileId: string;
  offset: number;
  size: number;
};
