import { PktLine } from "./pkt";

export type GitService = "upload-pack" | "receive-pack";

const CONTENT_TYPES = {
  advertisement: (service: GitService) =>
    `application/x-git-${service}-advertisement`,
  result: (service: GitService) => `application/x-git-${service}-result`,
} as const;

export function gitResponse(
  body: Uint8Array,
  service: GitService,
  type: "advertisement" | "result"
) {
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[type](service),
      "Cache-Control": "no-cache",
    },
  });
}

export function gitStreamResponse(
  body: ReadableStream<Uint8Array>,
  service: GitService
) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES.result(service),
      "Cache-Control": "no-cache",
    },
  });
}
export function gitErrorResponse(
  message: string,
  service: GitService
): Response {
  const body = PktLine.encode(`ERR ${message}\n`);

  return new Response(body as unknown as BodyInit, {
    status: 200, // Git protocol errors use 200 with ERR pkt-line
    headers: {
      "Content-Type": CONTENT_TYPES.result(service),
      "Cache-Control": "no-cache",
    },
  });
}
