import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  todos: defineTable({
    text: v.string(),
    completed: v.boolean(),
  }),

  repositories: defineTable({
    ownerId: v.string(),
    owner: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    isPrivate: v.boolean(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_owner", ["owner"])
    .index("by_owner_name", ["owner", "name"]),

  issues: defineTable({
    repositoryId: v.id("repositories"),
    fullName: v.string(), // e.g., "owner/repo"
    number: v.number(),
    title: v.string(),
    body: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("closed")),
    creatorId: v.string(),
    creatorUsername: v.string(),
  })
    .index("by_repositoryId", ["repositoryId"])
    .index("by_fullName", ["fullName"])
    .index("by_fullName_status", ["fullName", "status"])
    .index("by_fullName_number", ["fullName", "number"]),

  pullRequests: defineTable({
    repositoryId: v.id("repositories"),
    fullName: v.string(), // e.g., "owner/repo"
    number: v.number(),
    title: v.string(),
    body: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("closed"),
      v.literal("merged")
    ),
    intoBranch: v.string(),
    fromBranch: v.string(),
    creatorId: v.string(),
    creatorUsername: v.string(),
  })
    .index("by_repositoryId", ["repositoryId"])
    .index("by_fullName", ["fullName"])
    .index("by_fullName_status", ["fullName", "status"])
    .index("by_fullName_number", ["fullName", "number"]),

  comments: defineTable({
    authorId: v.string(),
    authorUsername: v.string(),
    body: v.string(),
    issueId: v.optional(v.id("issues")),
    prId: v.optional(v.id("pullRequests")),
  })
    .index("by_issue", ["issueId"])
    .index("by_pr", ["prId"]),
});
