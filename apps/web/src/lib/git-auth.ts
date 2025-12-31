import { Repo } from "@/db/repo";
import { getBasicCredentials } from "@/git/protocol";
import { auth } from "./auth";
import { UnauthorizedError } from "./errors";
import { Result } from "./result";

type VerifyAuthArgs = {
  owner: string;
  repo: string;
  req: Request;
  service: "upload-pack" | "receive-pack";
};

type VerifyAuthResult = {
  valid: boolean;
  message: string;
};

export async function verifyAuth({
  owner,
  repo,
  req,
  service,
}: VerifyAuthArgs): Promise<boolean> {
  const result = await checkPermissionByPAT({ owner, repo, req, service });
  return result.valid;
}

async function checkPermissionByPAT({
  owner,
  repo,
  req,
  service,
}: VerifyAuthArgs): Promise<VerifyAuthResult> {
  const basic = getBasicCredentials(req);
  const token = basic && basic.username === owner ? basic.password : undefined;

  // Step 1: Check if repository exists
  const repoResult = await Repo.getByOwnerAndName({ owner, name: repo });

  if (repoResult.isErr()) {
    return { valid: false, message: "Database error" };
  }

  const repository = repoResult.value;

  if (!repository) {
    return { valid: false, message: "Repository not found" };
  }

  const isPullOperation = service === "upload-pack";
  const isPushOperation = service === "receive-pack";
  const hasToken = !!token;

  // Step 2: Handle anonymous access (no token provided)
  if (!hasToken) {
    // Rule: Push always requires authentication
    if (isPushOperation) {
      return {
        valid: false,
        message: "Authentication required for push operations",
      };
    }

    // Rule: Pull on private repos requires authentication
    if (isPullOperation && repository.isPrivate) {
      return {
        valid: false,
        message: "Authentication required for private repository",
      };
    }

    // Rule: Pull on public repos is allowed anonymously
    return {
      valid: true,
      message: "Anonymous access allowed for public repository",
    };
  }

  // Step 3: Verify the provided token
  const tokenVerificationResult = await Result.tryCatchAsync(
    () => auth.api.verifyApiKey({ body: { key: token.trim() } }),
    (e) => new UnauthorizedError({ cause: e })
  );

  if (tokenVerificationResult.isErr()) {
    return { valid: false, message: "Token verification failed" };
  }

  const tokenVerification = tokenVerificationResult.value;

  if (!tokenVerification.valid) {
    return {
      valid: false,
      message: tokenVerification.error?.message || "Invalid token",
    };
  }

  const isOwner = repository.ownerId === tokenVerification.key?.userId;

  // Step 4: Apply ownership rules for authenticated users
  // Rule: Only owner can push
  if (isPushOperation && !isOwner) {
    return {
      valid: false,
      message: "Not authorized to push to this repository",
    };
  }

  // Rule: Only owner can pull private repos
  if (isPullOperation && repository.isPrivate && !isOwner) {
    return {
      valid: false,
      message: "Not authorized to access private repository",
    };
  }

  // All checks passed
  return { valid: true, message: "Authorized" };
}
