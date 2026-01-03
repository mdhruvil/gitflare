import { relations } from "drizzle-orm";
import { comment, issue, pullRequest, repository } from ".";
import { account, apikey, session, user } from "./auth";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  apikeys: many(apikey),

  repositories: many(repository),
  issues: many(issue),
  pullRequests: many(pullRequest),
  comments: many(comment),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const apikeyRelations = relations(apikey, ({ one }) => ({
  user: one(user, {
    fields: [apikey.userId],
    references: [user.id],
  }),
}));

export const repositoryRelations = relations(repository, ({ one, many }) => ({
  owner: one(user, {
    fields: [repository.ownerId],
    references: [user.id],
  }),
  issues: many(issue),
  pullRequests: many(pullRequest),
}));

export const issueRelations = relations(issue, ({ one, many }) => ({
  repository: one(repository, {
    fields: [issue.repositoryId],
    references: [repository.id],
  }),
  creator: one(user, {
    fields: [issue.creatorId],
    references: [user.id],
  }),
  comments: many(comment),
}));

export const pullRequestRelations = relations(pullRequest, ({ one, many }) => ({
  repository: one(repository, {
    fields: [pullRequest.repositoryId],
    references: [repository.id],
  }),
  creator: one(user, {
    fields: [pullRequest.creatorId],
    references: [user.id],
  }),
  comments: many(comment),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  author: one(user, {
    fields: [comment.authorId],
    references: [user.id],
  }),
  issue: one(issue, {
    fields: [comment.issueId],
    references: [issue.id],
  }),
  pullRequest: one(pullRequest, {
    fields: [comment.pullRequestId],
    references: [pullRequest.id],
  }),
}));
