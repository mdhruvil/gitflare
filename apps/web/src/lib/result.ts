/**
 * Result type for typed error handling without exceptions.
 *
 * @example
 * ```typescript
 * const result = Result.ok(42)
 *   .map(x => x * 2)
 *   .andThen(x => x > 50 ? Result.ok(x) : Result.err("too small"));
 *
 * if (result.isOk()) {
 *   console.log(result.value);
 * } else {
 *   console.log(result.error);
 * }
 * ```
 */
/** biome-ignore-all lint/style/noParameterProperties: <idc> */

export type Result<T, E> = Ok<T, E> | Err<T, E>;

// SAFETY: Ok only stores `value: T`. The `E` type parameter is phantom (unused at runtime).
// Casting Ok<T, E> to Ok<T, F> is safe because E has no runtime representation.
/**
 * Success variant of Result.
 *
 * @template T - The success value type
 * @template E - The error type (phantom, unused at runtime)
 */
export class Ok<T, E> {
  readonly _tag = "Ok" as const;
  constructor(readonly value: T) {}

  /**
   * Type guard for Ok variant.
   *
   * @returns true
   */
  isOk(): this is Ok<T, E> {
    return true;
  }

  /**
   * Type guard for Err variant.
   *
   * @returns false
   */
  isErr(): this is Err<T, E> {
    return false;
  }

  /**
   * Transform the success value.
   *
   * @param fn - Transform function
   * @returns New Result with transformed value
   */
  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  /**
   * Transform the error value. No-op for Ok.
   *
   * @param _fn - Transform function (not called)
   * @returns This Ok with new error type
   */
  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    // SAFETY: E is phantom in Ok; see class comment
    return this as unknown as Ok<T, F>;
  }

  /**
   * Chain a Result-returning function on success.
   *
   * @param fn - Function returning a new Result
   * @returns Result from fn
   */
  andThen<U, F>(fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return fn(this.value);
  }

  /**
   * Recover from error with a Result-returning function. No-op for Ok.
   *
   * @param _fn - Recovery function (not called)
   * @returns This Ok with new error type
   */
  orElse<F>(_fn: (error: E) => Result<T, F>): Result<T, F> {
    // SAFETY: E is phantom in Ok; see class comment
    return this as unknown as Ok<T, F>;
  }

  /**
   * Extract success value.
   *
   * @returns The success value
   */
  unwrap(): T {
    return this.value;
  }

  /**
   * Extract success value or return default.
   *
   * @param _defaultValue - Default value (not used)
   * @returns The success value
   */
  unwrapOr(_defaultValue: T): T {
    return this.value;
  }

  /**
   * Extract error value.
   *
   * @throws Error always (Ok has no error)
   */
  unwrapErr(): E {
    throw new Error("Called unwrapErr on Ok");
  }

  /**
   * Pattern match on Result.
   *
   * @param handlers - Object with ok and err handlers
   * @returns Result of ok handler
   */
  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return handlers.ok(this.value);
  }
}

// SAFETY: Err only stores `error: E`. The `T` type parameter is phantom (unused at runtime).
// Casting Err<T, E> to Err<U, E> is safe because T has no runtime representation.
/**
 * Failure variant of Result.
 *
 * @template T - The success type (phantom, unused at runtime)
 * @template E - The error value type
 */
export class Err<T, E> {
  readonly _tag = "Err" as const;
  constructor(readonly error: E) {}

  /**
   * Type guard for Ok variant.
   *
   * @returns false
   */
  isOk(): this is Ok<T, E> {
    return false;
  }

  /**
   * Type guard for Err variant.
   *
   * @returns true
   */
  isErr(): this is Err<T, E> {
    return true;
  }

  /**
   * Transform the success value. No-op for Err.
   *
   * @param _fn - Transform function (not called)
   * @returns This Err with new success type
   */
  map<U>(_fn: (value: T) => U): Result<U, E> {
    // SAFETY: T is phantom in Err; see class comment
    return this as unknown as Err<U, E>;
  }

  /**
   * Transform the error value.
   *
   * @param fn - Transform function
   * @returns New Err with transformed error
   */
  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }

  /**
   * Chain a Result-returning function on success. No-op for Err.
   *
   * @param _fn - Function returning a new Result (not called)
   * @returns This Err with union error type
   */
  andThen<U, F>(_fn: (value: T) => Result<U, F>): Result<U, E | F> {
    // SAFETY: T is phantom in Err; see class comment
    return this as unknown as Err<U, E>;
  }

  /**
   * Recover from error with a Result-returning function.
   *
   * @param fn - Recovery function
   * @returns Result from fn
   */
  orElse<F>(fn: (error: E) => Result<T, F>): Result<T, F> {
    return fn(this.error);
  }

  /**
   * Extract success value.
   *
   * @throws Error always (Err has no success value)
   */
  unwrap(): T {
    throw new Error("Called unwrap on Err");
  }

  /**
   * Extract success value or return default.
   *
   * @param defaultValue - Default value to return
   * @returns The default value
   */
  unwrapOr(defaultValue: T): T {
    return defaultValue;
  }

  /**
   * Extract error value.
   *
   * @returns The error value
   */
  unwrapErr(): E {
    return this.error;
  }

  /**
   * Pattern match on Result.
   *
   * @param handlers - Object with ok and err handlers
   * @returns Result of err handler
   */
  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return handlers.err(this.error);
  }
}

/**
 * Create a success Result.
 *
 * @param value - The success value
 * @returns Ok containing value
 *
 * @example
 * ```typescript
 * const result = Result.ok(42);
 * ```
 */
function ok<T, E = never>(value: T): Result<T, E> {
  return new Ok(value);
}

/**
 * Create a failure Result.
 *
 * @param error - The error value
 * @returns Err containing error
 *
 * @example
 * ```typescript
 * const result = Result.err("not found");
 * ```
 */
function err<E, T = never>(error: E): Result<T, E> {
  return new Err(error);
}

/**
 * Wrap a throwing function in a Result.
 *
 * @param fn - Function that may throw
 * @param onError - Transform caught value to error type
 * @returns Ok with return value or Err with transformed error
 *
 * @example
 * ```typescript
 * const result = Result.tryCatch(
 *   () => JSON.parse(input),
 *   (e) => new ParseError({ cause: e })
 * );
 * ```
 */
function tryCatch<T, E = Error>(
  fn: () => T,
  onError: (e: unknown) => E = (e) => e as E
): Result<T, E> {
  try {
    return ok(fn());
  } catch (e) {
    return err(onError(e));
  }
}

/**
 * Wrap an async throwing function in a Result.
 *
 * @param fn - Async function that may throw
 * @param onError - Transform caught value to error type
 * @returns Promise of Ok with return value or Err with transformed error
 *
 * @example
 * ```typescript
 * const result = await Result.tryCatchAsync(
 *   () => fetch(url).then(r => r.json()),
 *   (e) => new FetchError({ cause: e })
 * );
 * ```
 */
async function tryCatchAsync<T, E = Error>(
  fn: () => Promise<T>,
  onError: (e: unknown) => E = (e) => e as E
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(onError(e));
  }
}

/**
 * Convert array of Results to Result of array. Fails on first error.
 *
 * @param results - Array of Results
 * @returns Ok with array of values or first Err encountered
 *
 * @example
 * ```typescript
 * const results = [Result.ok(1), Result.ok(2), Result.ok(3)];
 * const combined = Result.all(results); // Ok([1, 2, 3])
 * ```
 */
function all<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (result.isErr()) {
      // SAFETY: T is phantom in Err; Err<T, E> and Err<T[], E> are identical at runtime
      return result as unknown as Err<T[], E>;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Partition array of Results into [oks, errs].
 *
 * @param results - Array of Results
 * @returns Tuple of [ok values, error values]
 *
 * @example
 * ```typescript
 * const results = [Result.ok(1), Result.err("a"), Result.ok(2), Result.err("b")];
 * const [oks, errs] = Result.partition(results); // [[1, 2], ["a", "b"]]
 * ```
 */
function partition<T, E>(results: Result<T, E>[]): [T[], E[]] {
  const oks: T[] = [];
  const errs: E[] = [];
  for (const result of results) {
    if (result.isErr()) {
      errs.push(result.error);
    } else {
      oks.push(result.value);
    }
  }
  return [oks, errs];
}

/**
 * Return first Ok or last Err from array of Results.
 *
 * @param results - Non-empty array of Results
 * @returns First Ok found or last Err if all fail
 * @throws Error if array is empty
 *
 * @example
 * ```typescript
 * const results = [Result.err("a"), Result.ok(42), Result.err("b")];
 * const first = Result.firstOk(results); // Ok(42)
 * ```
 */
function firstOk<T, E>(results: Result<T, E>[]): Result<T, E> {
  let lastErr: Result<T, E> | undefined;
  for (const result of results) {
    if (result.isOk()) {
      return result;
    }
    lastErr = result;
  }
  if (lastErr) {
    return lastErr;
  }
  throw new Error("firstOk called with empty array");
}

export type InferOk<T> = T extends Ok<infer R, unknown> ? R : never;
export type InferErr<T> = T extends Err<unknown, infer E> ? E : never;

export const Result = {
  ok,
  err,
  tryCatch,
  tryCatchAsync,
  all,
  partition,
  firstOk,
} as const;
