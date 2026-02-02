import { Result, TaggedError } from "better-result";
import { NotFoundError } from "../lib/errors";

type R2Reason =
  | { op: "head"; key: string }
  | { op: "get"; key: string }
  | { op: "put"; key: string }
  | { op: "delete"; keys: string | string[] }
  | { op: "list" };

export class R2Error extends TaggedError("R2Error")<{
  reason: R2Reason;
  cause: unknown;
  message: string;
}>() {
  constructor(args: { reason: R2Reason; cause: unknown }) {
    const message = R2Error.#formatMessage(args.reason, args.cause);
    super({ ...args, message });
  }

  static #formatMessage(reason: R2Reason, cause: unknown): string {
    let causeStr = "";
    if (cause instanceof Error) {
      causeStr = cause.message;
    } else if (cause) {
      causeStr = String(cause);
    }
    const suffix = causeStr ? `: ${causeStr}` : "";

    switch (reason.op) {
      case "head":
        return `Failed to get metadata for "${reason.key}"${suffix}`;
      case "get":
        return `Failed to get "${reason.key}"${suffix}`;
      case "put":
        return `Failed to put "${reason.key}"${suffix}`;
      case "delete": {
        const keyStr = Array.isArray(reason.keys)
          ? reason.keys.join(", ")
          : reason.keys;
        return `Failed to delete "${keyStr}"${suffix}`;
      }
      case "list":
        return `Failed to list objects${suffix}`;
      default: {
        const _exhaustive: never = reason;
        return _exhaustive;
      }
    }
  }
}

type R2PutValue =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null
  | Blob;

export class R2 {
  readonly #bucket: R2Bucket;
  private req = 0;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async head(key: string) {
    return (
      await Result.tryPromise({
        try: () => this.#bucket.head(key),
        catch: (cause) => new R2Error({ reason: { op: "head", key }, cause }),
      })
    ).andThen((value) =>
      value === null
        ? Result.err(new NotFoundError({ what: `R2 object "${key}"` }))
        : Result.ok(value)
    );
  }

  get(
    key: string,
    options: R2GetOptions & { onlyIf: R2Conditional | Headers }
  ): Promise<Result<R2ObjectBody | R2Object, R2Error | NotFoundError>>;

  get(
    key: string,
    options?: R2GetOptions
  ): Promise<Result<R2ObjectBody, R2Error | NotFoundError>>;

  async get(key: string, options?: R2GetOptions) {
    this.req += 1;
    console.log(`[R2][${this.req}] GET ${key}`);
    return (
      await Result.tryPromise({
        try: () =>
          this.#bucket.get(key, options as R2GetOptions) as Promise<
            R2ObjectBody | R2Object | null
          >,
        catch: (cause) => new R2Error({ reason: { op: "get", key }, cause }),
      })
    ).andThen((value) =>
      value === null
        ? Result.err(new NotFoundError({ what: `R2 object "${key}"` }))
        : Result.ok(value)
    );
  }

  put(
    key: string,
    value: R2PutValue,
    options: R2PutOptions & { onlyIf: R2Conditional | Headers }
  ): Promise<Result<R2Object | null, R2Error>>;

  put(
    key: string,
    value: R2PutValue,
    options?: R2PutOptions
  ): Promise<Result<R2Object, R2Error>>;

  put(key: string, value: R2PutValue, options?: R2PutOptions) {
    return Result.tryPromise({
      try: () => this.#bucket.put(key, value, options),
      catch: (cause) => new R2Error({ reason: { op: "put", key }, cause }),
    });
  }

  delete(keys: string | string[]) {
    return Result.tryPromise({
      try: () => this.#bucket.delete(keys),
      catch: (cause) => new R2Error({ reason: { op: "delete", keys }, cause }),
    });
  }

  list(options?: R2ListOptions) {
    return Result.tryPromise({
      try: () => this.#bucket.list(options),
      catch: (cause) => new R2Error({ reason: { op: "list" }, cause }),
    });
  }
}
