import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const repository = sqliteTable(
  "repository",
  {
    id: integer("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(), // username of the owner
    name: text("name").notNull(),
    description: text("description"),
    isPrivate: integer("is_private", { mode: "boolean" })
      .default(false)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("repository_ownerId_idx").on(table.ownerId),
    index("repository_owner_idx").on(table.owner),
    index("repository_name_idx").on(table.name),
  ]
);

export const issue = sqliteTable(
  "issue",
  {
    id: integer("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(), // e.g., "owner/repo"
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    status: text("status", { enum: ["open", "closed"] })
      .default("open")
      .notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    creatorUsername: text("creator_username").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("issue_repositoryId_idx").on(table.repositoryId),
    index("issue_fullName_idx").on(table.fullName),
    index("issue_number_idx").on(table.number),
    index("issue_status_idx").on(table.status),
  ]
);

export const pullRequest = sqliteTable(
  "pull_request",
  {
    id: integer("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(), // e.g., "owner/repo"
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    status: text("status", { enum: ["open", "closed", "merged"] })
      .default("open")
      .notNull(),
    intoBranch: text("into_branch").notNull(),
    fromBranch: text("from_branch").notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    creatorUsername: text("creator_username").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("pullRequest_repositoryId_idx").on(table.repositoryId),
    index("pullRequest_fullName_idx").on(table.fullName),
    index("pullRequest_status_idx").on(table.status),
    index("pullRequest_number_idx").on(table.number),
  ]
);

export const comment = sqliteTable(
  "comment",
  {
    id: integer("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    authorUsername: text("author_username").notNull(),
    body: text("body").notNull(),
    issueId: integer("issue_id").references(() => issue.id, {
      onDelete: "cascade",
    }),
    pullRequestId: integer("pull_request_id").references(() => pullRequest.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("comment_issueId_idx").on(table.issueId),
    index("comment_pullRequestId_idx").on(table.pullRequestId),
  ]
);
