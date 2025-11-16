import type { ErrorComponentProps } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

export function ErrorComponent({ error, info }: ErrorComponentProps) {
  let errorMessage = error.message;
  console.log(info);
  if (
    error instanceof ConvexError &&
    error.data &&
    typeof error.data === "string"
  ) {
    errorMessage = error.data;
  }
  return (
    <div className="p-4">
      <Alert className="mb-6" variant="destructive">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    </div>
  );
}
