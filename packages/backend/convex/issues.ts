import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Get issues by repository fullName (owner/repo)
 */
export const getByRepo = query({
  args: {
    fullName: v.string(),
    status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    // Get the repository to check privacy
    const [owner, name] = args.fullName.split("/");
    if (!owner || !name) {
      throw new Error("Invalid fullName format. Expected 'owner/repo'");
    }

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();

    if (!repo) {
      throw new Error("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new Error("Repository not found");
    }

    // Get issues filtered by status if provided
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("issues")
        .withIndex("by_fullName_status", (q) =>
          q.eq("fullName", args.fullName).eq("status", status)
        )
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("issues")
      .withIndex("by_fullName", (q) => q.eq("fullName", args.fullName))
      .order("desc")
      .collect();
  },
});

/**
 * Get a specific issue by fullName and number
 */
export const getByRepoAndNumber = query({
  args: {
    fullName: v.string(),
    number: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    // Get the repository to check privacy
    const [owner, name] = args.fullName.split("/");
    if (!owner || !name) {
      throw new Error("Invalid fullName format. Expected 'owner/repo'");
    }

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();

    if (!repo) {
      throw new Error("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new Error("Repository not found");
    }

    const issue = await ctx.db
      .query("issues")
      .withIndex("by_fullName_number", (q) =>
        q.eq("fullName", args.fullName).eq("number", args.number)
      )
      .unique();

    if (!issue) {
      throw new Error("Issue not found");
    }

    return issue;
  },
});

/**
 * Create a new issue
 */
export const create = mutation({
  args: {
    fullName: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new Error("Not authenticated");
    }

    // Get the repository
    const [owner, name] = args.fullName.split("/");
    if (!owner || !name) {
      throw new Error("Invalid fullName format. Expected 'owner/repo'");
    }

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();

    if (!repo) {
      throw new Error("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && repo.ownerId !== user._id) {
      throw new Error("Not authorized to create issues in this repository");
    }

    // Get the next issue number for this repository
    const lastIssue = await ctx.db
      .query("issues")
      .withIndex("by_fullName_number", (q) => q.eq("fullName", args.fullName))
      .order("desc")
      .first();

    const nextNumber = lastIssue ? lastIssue.number + 1 : 1;

    const newIssueId = await ctx.db.insert("issues", {
      repositoryId: repo._id,
      fullName: args.fullName,
      number: nextNumber,
      title: args.title,
      body: args.body,
      status: "open",
    });

    return newIssueId;
  },
});

/**
 * Update an issue
 */
export const update = mutation({
  args: {
    id: v.id("issues"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new Error("Not authenticated");
    }

    const issue = await ctx.db.get(args.id);
    if (!issue) {
      throw new Error("Issue not found");
    }

    // Get the repository to check permissions
    const repo = await ctx.db.get(issue.repositoryId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    // Check if user has permission to update
    if (repo.ownerId !== user._id) {
      throw new Error("Not authorized to update this issue");
    }

    // Build update object with only provided fields
    const updates: Partial<{
      title: string;
      body: string | undefined;
      status: "open" | "closed";
    }> = {};

    if (args.title !== undefined) {
      updates.title = args.title;
    }
    if (args.body !== undefined) {
      updates.body = args.body;
    }
    if (args.status !== undefined) {
      updates.status = args.status;
    }

    await ctx.db.patch(args.id, updates);
  },
});

/**
 * Delete an issue
 */
export const deleteIssue = mutation({
  args: {
    id: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new Error("Not authenticated");
    }

    const issue = await ctx.db.get(args.id);
    if (!issue) {
      throw new Error("Issue not found");
    }

    // Get the repository to check permissions
    const repo = await ctx.db.get(issue.repositoryId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    // Check if user is the owner
    if (repo.ownerId !== user._id) {
      throw new Error("Not authorized to delete this issue");
    }

    // Delete associated comments
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issue", (q) => q.eq("issueId", args.id))
      .collect();
    for (const comment of comments) {
      await ctx.db.delete(comment._id);
    }

    // Delete the issue
    await ctx.db.delete(args.id);
  },
});
