import type * as z from "zod";
import { TaggedError } from "./tagged-error";

/**
 * Validation error containing Zod issues.
 * Returned when input validation fails.
 */
export class ValidationError extends TaggedError("ValidationError")<{
  message?: string;
  issues: z.core.$ZodIssue[];
}> {}

/**
 * Database error wrapping underlying database exceptions.
 * Returned when a database operation fails.
 */
export class DatabaseError extends TaggedError("DatabaseError")<{
  cause?: unknown;
}> {}

export class UnauthorizedError extends TaggedError("UnauthorizedError")<{
  cause?: unknown;
}> {}

export class NotFoundError extends TaggedError("NotFoundError")<{
  cause?: unknown;
  what?: string;
}> {}
