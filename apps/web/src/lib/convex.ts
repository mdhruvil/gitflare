import { notFound } from "@tanstack/react-router";
import { ConvexError } from "convex/values";

export function handleAndThrowConvexError(err: unknown): never {
  if (err instanceof ConvexError && err.data && typeof err.data === "string") {
    if (err.data === "NOT_FOUND") {
      console.log("Throwing 404 Not Found");
      throw notFound();
    }
    throw new Error(err.data);
  }
  throw new Error("An unknown error occurred");
}
