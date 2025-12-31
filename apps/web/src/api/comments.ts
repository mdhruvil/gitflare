import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import * as z from "zod";
import { Comment } from "@/db/comment";
import { auth } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { Result } from "@/lib/result";

const createCommentForIssueSchema = z.object({
  issueId: z.number(),
  body: z.string(),
});

export const createCommentForIssueFn = createServerFn({ method: "POST" })
  .inputValidator(createCommentForIssueSchema)
  .handler(async ({ data }) => {
    const sessionResult = (
      await Result.tryCatchAsync(
        () => auth.api.getSession({ headers: getRequestHeaders() }),
        (e) => new UnauthorizedError({ cause: e })
      )
    ).andThen((session) =>
      session ? Result.ok(session) : Result.err(new UnauthorizedError())
    );
    const { user } = sessionResult.unwrapOrThrow({
      UnauthorizedError: "You must be logged in to create a comment.",
    });

    if (!user.username) {
      throw new Error("User does not have a username");
    }

    const commentResult = await Comment.createForIssue({
      issueId: data.issueId,
      authorId: user.id,
      authorUsername: user.username,
      body: data.body,
    });

    return commentResult.unwrapOrThrow({
      DatabaseError: "Database error occurred while creating comment.",
    });
  });
