import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

export function ErrorComponent({ error, info }: ErrorComponentProps) {
  const errorMessage = error.message;
  console.log(info);
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
