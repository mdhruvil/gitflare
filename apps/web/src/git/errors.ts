import { TaggedError } from "better-result";

export class ProtocolError extends TaggedError("ProtocolError")<{
  code:
    | "INVALID_PKT_LINE"
    | "MALFORMED_COMMAND"
    | "MISSING_FLUSH"
    | "INVALID_PACKFILE"
    // upload-pack specific
    | "INVALID_WANT"
    | "TRAVERSAL_ERROR"
    | "PACK_WRITE_ERROR"
    | "REPO_TOO_LARGE";
  detail?: string;
}>() {}

export class ReceivePackError extends TaggedError("ReceivePackError")<{
  code: "PARSE_FAILED" | "INDEX_FAILED" | "UPLOAD_FAILED" | "REF_UPDATE_FAILED";
  cause?: Error;
}>() {}
