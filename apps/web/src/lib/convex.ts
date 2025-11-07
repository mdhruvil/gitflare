import { ConvexError } from "convex/values";

export function handleAndThrowConvexError(err: unknown): never {
  if (err instanceof ConvexError && err.data && typeof err.data === "string") {
    throw new Error(err.data);
  }
  throw new Error("An unknown error occurred");
}
