import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Get pull requests by repository fullName (owner/repo)
 */
export const getByRepo = query({
  args: {
    fullName: v.string(),
    status: v.optional(
      v.union(v.literal("open"), v.literal("closed"), v.literal("merged"))
    ),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    // Get the repository to check privacy
    const [owner, name] = args.fullName.split("/");
    if (!owner || !name) {
      throw new ConvexError("Invalid fullName format. Expected 'owner/repo'");
    }

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();

    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new ConvexError("Repository not found");
    }

    // Get pull requests filtered by status if provided
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("pullRequests")
        .withIndex("by_fullName_status", (q) =>
          q.eq("fullName", args.fullName).eq("status", status)
        )
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("pullRequests")
      .withIndex("by_fullName", (q) => q.eq("fullName", args.fullName))
      .order("desc")
      .collect();
  },
});

/**
 * Get a specific pull request by fullName and number
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
      throw new ConvexError("Invalid fullName format. Expected 'owner/repo'");
    }

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();

    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new ConvexError("Repository not found");
    }

    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_fullName_number", (q) =>
        q.eq("fullName", args.fullName).eq("number", args.number)
      )
      .unique();

    if (!pr) {
      throw new ConvexError("Pull request not found");
    }

    return pr;
  },
});

/**
 * Create a new pull request
 */
export const create = mutation({
  args: {
    fullName: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    intoBranch: v.string(),
    fromBranch: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    if (!user.username) {
      throw new ConvexError("Username is required");
    }

    // Get the repository
    const [owner, name] = args.fullName.split("/");
    if (!owner || !name) {
      throw new ConvexError("Invalid fullName format. Expected 'owner/repo'");
    }

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();

    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && repo.ownerId !== user._id) {
      throw new ConvexError(
        "Not authorized to create pull requests in this repository"
      );
    }

    // Get the next PR number for this repository
    const lastPr = await ctx.db
      .query("pullRequests")
      .withIndex("by_fullName_number", (q) => q.eq("fullName", args.fullName))
      .order("desc")
      .first();

    const nextNumber = lastPr ? lastPr.number + 1 : 1;

    const newPrId = await ctx.db.insert("pullRequests", {
      repositoryId: repo._id,
      fullName: args.fullName,
      number: nextNumber,
      title: args.title,
      body: args.body,
      status: "open",
      intoBranch: args.intoBranch,
      fromBranch: args.fromBranch,
      creatorId: user._id,
      creatorUsername: user.username,
    });

    return newPrId;
  },
});

/**
 * Update a pull request
 */
export const update = mutation({
  args: {
    id: v.id("pullRequests"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("closed"), v.literal("merged"))
    ),
    intoBranch: v.optional(v.string()),
    fromBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    const pr = await ctx.db.get(args.id);
    if (!pr) {
      throw new ConvexError("Pull request not found");
    }

    // Check if user is the creator of the pull request
    if (pr.creatorId !== user._id) {
      throw new ConvexError("Not authorized to update this pull request");
    }

    // Build update object with only provided fields
    const updates: Partial<{
      title: string;
      body: string | undefined;
      status: "open" | "closed" | "merged";
      intoBranch: string;
      fromBranch: string;
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
    if (args.intoBranch !== undefined) {
      updates.intoBranch = args.intoBranch;
    }
    if (args.fromBranch !== undefined) {
      updates.fromBranch = args.fromBranch;
    }

    await ctx.db.patch(args.id, updates);
  },
});

/**
 * Delete a pull request
 */
export const deletePullRequest = mutation({
  args: {
    id: v.id("pullRequests"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    const pr = await ctx.db.get(args.id);
    if (!pr) {
      throw new ConvexError("Pull request not found");
    }

    // Check if user is the creator of the pull request
    if (pr.creatorId !== user._id) {
      throw new ConvexError("Not authorized to delete this pull request");
    }

    // Delete associated comments
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_pr", (q) => q.eq("prId", args.id))
      .collect();
    for (const comment of comments) {
      await ctx.db.delete(comment._id);
    }

    // Delete the pull request
    await ctx.db.delete(args.id);
  },
});
