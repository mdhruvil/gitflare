import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Get repositories by owner username
 */
export const getByOwner = query({
  args: {
    owner: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    const repos = await ctx.db
      .query("repositories")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .collect();

    // Filter out private repositories unless the user is the owner
    return repos.filter(
      (repo) => !repo.isPrivate || (user && repo.ownerId === user._id)
    );
  },
});

/**
 * Get a specific repository by owner and name
 */
export const getByOwnerAndName = query({
  args: {
    owner: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) =>
        q.eq("owner", args.owner).eq("name", args.name)
      )
      .unique();

    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    // Throw error if repository is private and user is not the owner
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new ConvexError("Repository not found");
    }

    return repo;
  },
});

/**
 * Create a new repository
 */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    isPrivate: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    if (!user.username) {
      throw new ConvexError("User does not have a username");
    }

    const username = user.username;

    if (!/^[a-zA-Z0-9_-]+$/.test(args.name)) {
      // Validate repository name (basic validation)
      throw new ConvexError(
        "Repository name can only contain letters, numbers, hyphens, and underscores"
      );
    }

    // Check if repository with same owner and name already exists
    const existing = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) =>
        q.eq("owner", username).eq("name", args.name)
      )
      .unique();

    if (existing) {
      throw new ConvexError("Repository with this name already exists");
    }

    const newRepoId = await ctx.db.insert("repositories", {
      ownerId: user._id,
      owner: user.username,
      name: args.name,
      description: args.description,
      isPrivate: args.isPrivate,
    });

    return {
      _id: newRepoId,
      fullName: `${username}/${args.name}`,
      owner: username,
      name: args.name,
      description: args.description,
      isPrivate: args.isPrivate,
    };
  },
});

/**
 * Update repository details
 */
export const update = mutation({
  args: {
    id: v.id("repositories"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isPrivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    const repo = await ctx.db.get(args.id);
    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    if (repo.ownerId !== user._id) {
      // Check if user is the owner
      throw new ConvexError("Not authorized to update this repository");
    }

    if (!user.username) {
      throw new ConvexError("User does not have a username");
    }

    const username = user.username;

    if (args.name !== undefined && args.name !== repo.name) {
      // If updating name, validate and check for conflicts
      const newName = args.name;

      if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
        throw new ConvexError(
          "Repository name can only contain letters, numbers, hyphens, and underscores"
        );
      }

      const existing = await ctx.db
        .query("repositories")
        .withIndex("by_owner_name", (q) =>
          q.eq("owner", username).eq("name", newName)
        )
        .unique();

      if (existing) {
        throw new ConvexError("Repository with this name already exists");
      }
    }

    // Build update object with only provided fields
    const updates: Partial<{
      name: string;
      description: string | undefined;
      isPrivate: boolean;
    }> = {};

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.description !== undefined) {
      updates.description = args.description;
    }
    if (args.isPrivate !== undefined) {
      updates.isPrivate = args.isPrivate;
    }

    await ctx.db.patch(args.id, updates);

    const updatedRepo = await ctx.db.get(args.id);
    if (!updatedRepo) {
      throw new ConvexError("Failed to update repository");
    }

    return updatedRepo;
  },
});

/**
 * Delete a repository
 */
export const deleteRepository = mutation({
  args: {
    id: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      throw new ConvexError("Not authenticated");
    }

    const repo = await ctx.db.get(args.id);
    if (!repo) {
      throw new ConvexError("Repository not found");
    }

    // Check if user is the owner
    if (repo.ownerId !== user._id) {
      throw new ConvexError("Not authorized to delete this repository");
    }

    // Delete associated issues and their comments
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_repositoryId", (q) => q.eq("repositoryId", args.id))
      .collect();
    for (const issue of issues) {
      // Delete comments associated with this issue
      const issueComments = await ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const comment of issueComments) {
        await ctx.db.delete(comment._id);
      }
      await ctx.db.delete(issue._id);
    }

    // Delete associated pull requests and their comments
    const prs = await ctx.db
      .query("pullRequests")
      .withIndex("by_repositoryId", (q) => q.eq("repositoryId", args.id))
      .collect();
    for (const pr of prs) {
      // Delete comments associated with this PR
      const prComments = await ctx.db
        .query("comments")
        .withIndex("by_pr", (q) => q.eq("prId", pr._id))
        .collect();
      for (const comment of prComments) {
        await ctx.db.delete(comment._id);
      }
      await ctx.db.delete(pr._id);
    }

    // Delete the repository
    await ctx.db.delete(args.id);

    return { success: true };
  },
});
