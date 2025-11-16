import type { DataModelFromSchemaDefinition } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import type authSchema from "./betterAuth/schema";

/**
 * Get repositories by owner username
 */
export const getByOwner = query({
  args: {
    owner: v.string(),
  },
  handler: async (ctx, args) => {
    type BetterAuthDataModel = DataModelFromSchemaDefinition<typeof authSchema>;

    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    const ownerData = (await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "user",
        where: [{ field: "username", value: args.owner }],
      }
    )) as BetterAuthDataModel["user"]["document"] | null;

    if (!ownerData) {
      throw new ConvexError("NOT_FOUND");
    }

    const repos = await ctx.db
      .query("repositories")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .collect();

    if (!repos || repos.length === 0) {
      return {
        owner: null,
        repos: [],
      };
    }

    // Filter out private repositories unless the user is the owner
    return {
      owner: {
        _id: ownerData?._id,
        username: ownerData?.username,
        name: ownerData?.name,
        email: ownerData?.email,
        createdAt: ownerData?.createdAt,
      },
      repos: repos.filter(
        (repo) => !repo.isPrivate || (user && repo.ownerId === user._id)
      ),
    };
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
      throw new ConvexError("NOT_FOUND");
    }

    // Throw error if repository is private and user is not the owner
    if (repo.isPrivate && (!user || repo.ownerId !== user._id)) {
      throw new ConvexError("NOT_FOUND");
    }

    return repo;
  },
});

export const checkPermissionByPAT = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    token: v.optional(v.string()),
    service: v.union(v.literal("upload-pack"), v.literal("receive-pack")),
  },
  handler: async (ctx, arg) => {
    // Step 1: Check if repository exists
    const repo = await ctx.db
      .query("repositories")
      .withIndex("by_owner_name", (q) =>
        q.eq("owner", arg.owner).eq("name", arg.repo)
      )
      .unique();

    if (!repo) {
      return { valid: false, message: "Repository not found" };
    }

    const isPullOperation = arg.service === "upload-pack";
    const isPushOperation = arg.service === "receive-pack";
    const hasToken = !!arg.token;

    // Step 2: Handle anonymous access (no token provided)
    if (!hasToken) {
      // Rule: Push always requires authentication
      if (isPushOperation) {
        return {
          valid: false,
          message: "Authentication required for push operations",
        };
      }

      // Rule: Pull on private repos requires authentication
      if (isPullOperation && repo.isPrivate) {
        return {
          valid: false,
          message: "Authentication required for private repository",
        };
      }

      // Rule: Pull on public repos is allowed anonymously
      return {
        valid: true,
        message: "Anonymous access allowed for public repository",
      };
    }

    // Step 3: Verify the provided token
    const { auth } = await authComponent.getAuth(createAuth, ctx);

    const tokenVerification = await auth.api.verifyApiKey({
      body: { key: arg.token?.trim() ?? "" },
    });

    if (!tokenVerification.valid) {
      return {
        valid: false,
        message: tokenVerification.error?.message || "Invalid token",
      };
    }

    const isOwner = repo.ownerId === tokenVerification.key?.userId;

    // Step 4: Apply ownership rules for authenticated users
    // Rule: Only owner can push
    if (isPushOperation && !isOwner) {
      return {
        valid: false,
        message: "Not authorized to push to this repository",
      };
    }

    // Rule: Only owner can pull private repos
    if (isPullOperation && repo.isPrivate && !isOwner) {
      return {
        valid: false,
        message: "Not authorized to access private repository",
      };
    }

    // All checks passed
    return { valid: true, message: "Authorized" };
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

    if (args.name.endsWith(".git")) {
      throw new ConvexError("Repository name cannot end with .git");
    }

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
      throw new ConvexError("NOT_FOUND");
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
      throw new ConvexError("NOT_FOUND");
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

/**
 * Get dashboard statistics for the authenticated user
 */
export const getMyStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx).catch(() => null);

    if (!user) {
      return {
        totalRepos: 0,
        openIssues: 0,
        openPRs: 0,
      };
    }

    // Get total repositories
    const repos = await ctx.db
      .query("repositories")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .collect();

    const totalRepos = repos.length;

    // Count open issues created by user
    const openIssues = await ctx.db
      .query("issues")
      .filter((q) =>
        q.and(
          q.eq(q.field("creatorId"), user._id),
          q.eq(q.field("status"), "open")
        )
      )
      .collect();

    // Count open pull requests created by user
    const openPRs = await ctx.db
      .query("pullRequests")
      .filter((q) =>
        q.and(
          q.eq(q.field("creatorId"), user._id),
          q.eq(q.field("status"), "open")
        )
      )
      .collect();

    return {
      totalRepos,
      openIssues: openIssues.length,
      openPRs: openPRs.length,
    };
  },
});
