import type * as z from "zod";
import { ValidationError } from "./errors";
import { Err, type Result } from "./result";

/**
 * Helper types to extract Ok and Err types from a Result.
 */
type InferOk<T> = T extends Result<infer R, unknown> ? R : never;
type InferErr<T> = T extends Result<unknown, infer E> ? E : never;

/**
 * Unwrap Promise if present, otherwise return T.
 */
type Awaited<T> = T extends Promise<infer U> ? U : T;

/**
 * Extract the inner Result from a potentially Promise-wrapped Result.
 */
type UnwrapResult<T> = Awaited<T> extends Result<infer O, infer E>
  ? Result<O, E>
  : never;

/**
 * Create a validated function that returns a Result.
 *
 * @param schema - Zod schema for input validation
 * @param cb - Callback that receives validated input and returns a Result (sync or async)
 * @returns Function that validates input and returns Result with ValidationError in error channel
 *
 * @example
 * ```typescript
 * // Sync example
 * const validateUser = fn(
 *   z.object({ name: z.string() }),
 *   (input) => Result.ok({ id: 1, ...input })
 * );
 *
 * // Async example
 * const createUser = fn(
 *   z.object({ name: z.string(), email: z.string().email() }),
 *   async (input) => {
 *     if (await emailExists(input.email)) {
 *       return Result.err(new EmailExistsError({ email: input.email }));
 *     }
 *     return Result.ok({ id: 1, ...input });
 *   }
 * );
 *
 * // Returns Promise<Result<User, ValidationError | EmailExistsError>>
 * const result = await createUser({ name: "test", email: "test@example.com" });
 * ```
 */
export function fn<
  T extends z.ZodType,
  Ret extends Result<unknown, unknown> | Promise<Result<unknown, unknown>>,
>(
  schema: T,
  cb: (input: z.infer<T>) => Ret
): {
  (
    input: unknown
  ): Ret extends Promise<unknown>
    ? Promise<
        Result<
          InferOk<UnwrapResult<Ret>>,
          ValidationError | InferErr<UnwrapResult<Ret>>
        >
      >
    : Result<
        InferOk<UnwrapResult<Ret>>,
        ValidationError | InferErr<UnwrapResult<Ret>>
      >;
  force: (input: z.infer<T>) => Ret;
  schema: T;
} {
  const result = (input: unknown) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const err = new Err(
        new ValidationError({
          message: parsed.error.message,
          issues: parsed.error.issues,
        })
      );
      // Check if callback returns a Promise by checking the prototype
      // We need to return the same type (Promise or not) as the callback
      const sample = cb.constructor.name === "AsyncFunction";
      return sample ? Promise.resolve(err) : err;
    }
    return cb(parsed.data);
  };

  result.force = (input: z.infer<T>): Ret => cb(input);
  result.schema = schema;

  // biome-ignore lint/suspicious/noExplicitAny: Complex type inference requires this cast
  return result as any;
}
