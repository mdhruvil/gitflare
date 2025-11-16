import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Get issues created by the authenticated user across all repositories
 */
export const getMyIssues = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      return [];
    }

    const issues = await ctx.db
      .query("issues")
      .filter((q) => q.eq(q.field("creatorId"), user._id))
      .order("desc")
      .take(args.limit ?? 10);

    return issues;
  },
});

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
      throw new ConvexError("Invalid fullName format. Expected 'owner/repo'");
    }

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();

    if (!repo) {
      throw new ConvexError("NOT_FOUND");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new ConvexError("NOT_FOUND");
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
  returns: v.object({
    _id: v.id("issues"),
    _creationTime: v.number(),
    repositoryId: v.id("repositories"),
    fullName: v.string(),
    number: v.number(),
    title: v.string(),
    body: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("closed")),
    creatorId: v.string(),
    creatorUsername: v.string(),
    canUpdate: v.boolean(),
    comments: v.array(
      v.object({
        _id: v.id("comments"),
        _creationTime: v.number(),
        authorId: v.string(),
        authorUsername: v.string(),
        body: v.string(),
        issueId: v.optional(v.id("issues")),
        prId: v.optional(v.id("pullRequests")),
      })
    ),
  }),
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
      throw new ConvexError("NOT_FOUND");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new ConvexError("NOT_FOUND");
    }

    const issue = await ctx.db
      .query("issues")
      .withIndex("by_fullName_number", (q) =>
        q.eq("fullName", args.fullName).eq("number", args.number)
      )
      .unique();

    if (!issue) {
      throw new ConvexError("Issue not found");
    }

    // Fetch all comments for this issue
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
      .order("asc")
      .collect();

    // Check if user can update this issue (creator or repo owner)
    const canUpdate =
      user !== null &&
      (issue.creatorId === user._id || repo.ownerId === user._id);

    return {
      ...issue,
      comments,
      canUpdate,
    };
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
      throw new ConvexError("NOT_FOUND");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && repo.ownerId !== user._id) {
      throw new ConvexError(
        "Not authorized to create issues in this repository"
      );
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
      creatorId: user._id,
      creatorUsername: user.username,
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
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    const issue = await ctx.db.get(args.id);
    if (!issue) {
      throw new ConvexError("Issue not found");
    }

    // Get the repository to check permissions
    const repo = await ctx.db.get(issue.repositoryId);
    if (!repo) {
      throw new ConvexError("NOT_FOUND");
    }

    // Check if user is the creator of the issue or the repository owner
    const isCreator = issue.creatorId === user._id;
    const isRepoOwner = repo.ownerId === user._id;

    if (!isCreator && !isRepoOwner) {
      throw new ConvexError("Not authorized to update this issue");
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
    return null;
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
      throw new ConvexError("Not authenticated");
    }

    const issue = await ctx.db.get(args.id);
    if (!issue) {
      throw new ConvexError("Issue not found");
    }

    // Check if user is the creator of the issue
    if (issue.creatorId !== user._id) {
      throw new ConvexError("Not authorized to delete this issue");
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
