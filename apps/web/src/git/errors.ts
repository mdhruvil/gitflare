import { TaggedError } from "better-result";

export class ProtocolError extends TaggedError("ProtocolError")<{
  code:
    | "INVALID_PKT_LINE"
    | "MALFORMED_COMMAND"
    | "MISSING_FLUSH"
    | "INVALID_PACKFILE";
  detail?: string;
}>() {}

export class ReceivePackError extends TaggedError("ReceivePackError")<{
  code: "PARSE_FAILED" | "INDEX_FAILED" | "UPLOAD_FAILED" | "REF_UPDATE_FAILED";
  cause?: Error;
}>() {}
