import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Add a comment to an issue
 */
export const addComment = mutation({
  args: {
    issueId: v.id("issues"),
    body: v.string(),
  },
  returns: v.id("comments"),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    if (!user.username) {
      throw new ConvexError("Username is required");
    }

    // Verify the issue exists
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new ConvexError("Issue not found");
    }

    // Get the repository to check privacy
    const repo = await ctx.db.get(issue.repositoryId);
    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && repo.ownerId !== user._id) {
      throw new ConvexError(
        "Not authorized to comment on issues in this repository"
      );
    }

    // Create the comment
    const commentId = await ctx.db.insert("comments", {
      authorId: user._id,
      authorUsername: user.username,
      body: args.body,
      issueId: args.issueId,
    });

    return commentId;
  },
});

/**
 * Get comments for an issue
 */
export const getByIssue = query({
  args: {
    issueId: v.id("issues"),
  },
  returns: v.array(
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
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    // Verify the issue exists
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new ConvexError("Issue not found");
    }

    // Get the repository to check privacy
    const repo = await ctx.db.get(issue.repositoryId);
    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    // Check if user has access to the repository
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new ConvexError("Repository not found");
    }

    // Get all comments for this issue
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .order("asc")
      .collect();

    return comments;
  },
});

/**
 * Delete a comment
 */
export const deleteComment = mutation({
  args: {
    id: v.id("comments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    const comment = await ctx.db.get(args.id);
    if (!comment) {
      throw new ConvexError("Comment not found");
    }

    // Check if user is the author of the comment
    if (comment.authorId !== user._id) {
      throw new ConvexError("Not authorized to delete this comment");
    }

    await ctx.db.delete(args.id);
    return null;
  },
});
