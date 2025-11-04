import handler, { type ServerEntry } from "@tanstack/react-start/server-entry";

export default {
  fetch: handler.fetch,
} satisfies ServerEntry;

// biome-ignore lint/performance/noBarrelFile: <needed for Durable Object export>
export { Repo } from "./do/repo";
