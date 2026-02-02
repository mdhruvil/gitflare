import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const GIT_OBJECT_TYPE = {
  commit: "commit",
  tree: "tree",
  blob: "blob",
  tag: "tag",
} as const;

export type GitObjectType =
  (typeof GIT_OBJECT_TYPE)[keyof typeof GIT_OBJECT_TYPE];

const gitObjectTypes = Object.values(GIT_OBJECT_TYPE) as [
  GitObjectType,
  ...GitObjectType[],
];

export const gitPacks = sqliteTable("git_packs", {
  packId: text("pack_id").primaryKey(),
  r2Key: text("r2_key").notNull(),
  objectCount: integer("object_count"),
  sizeBytes: integer("size_bytes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const gitObjectIndex = sqliteTable(
  "git_object_index",
  {
    oid: text("oid").primaryKey(),
    packId: text("pack_id")
      .notNull()
      .references(() => gitPacks.packId, { onDelete: "restrict" }),
    packOffset: integer("pack_offset").notNull(),
    compressedSize: integer("compressed_size").notNull(),
    type: text("type", { enum: gitObjectTypes }).notNull(),
    isDelta: integer("is_delta", { mode: "boolean" }).default(false).notNull(),
    /** For delta objects: OID of the base object */
    baseOid: text("base_oid"),
  },
  (table) => [index("idx_object_pack").on(table.packId)]
);

export const gitRefs = sqliteTable("git_refs", {
  /** Full ref name (e.g., "refs/heads/main", "HEAD") */
  name: text("name").primaryKey(),
  /** OID for direct refs, or ref path for symbolic refs */
  value: text("value").notNull(),
  /** Whether this is a symbolic ref (e.g., HEAD -> refs/heads/main) */
  isSymbolic: integer("is_symbolic", { mode: "boolean" })
    .default(false)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
});

export const commitGraph = sqliteTable("commit_graph", {
  oid: text("oid").primaryKey(),
  treeOid: text("tree_oid").notNull(),
  parentOids: text("parent_oids", { mode: "json" }).$type<string[]>().notNull(),
});
