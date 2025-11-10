import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { getBlobFn } from "@/api/tree";
import { getMimeType } from "@/lib/utils";

const searchSchema = z.object({
  ref: z.string().optional().default("main"),
  path: z.string(),
});

export const Route = createFileRoute("/$owner/$repo/_layout/_viewer/raw")({
  validateSearch: searchSchema,
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const ref = searchParams.get("ref") || "main";
        const filepath = searchParams.get("path") || "";

        if (!filepath) {
          return new Response("Path parameter is required", { status: 400 });
        }

        const { owner, repo } = params;

        try {
          const blob = await getBlobFn({
            data: {
              owner,
              repo,
              ref,
              filepath,
            },
          });

          if (!blob) {
            return new Response("File not found", { status: 404 });
          }

          // Decode base64 content
          const content = Buffer.from(blob.content, "base64");

          // Get filename for MIME type detection
          const pathParts = filepath.split("/");
          const filename = pathParts.at(-1) || filepath;

          // Determine content type
          const contentType = getMimeType(filename);

          // Return raw file content with appropriate headers
          return new Response(content, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Length": blob.size.toString(),
              "Content-Disposition": `inline; filename="${filename}"`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          console.error("Error fetching raw file:", error);
          return new Response("Internal server error", { status: 500 });
        }
      },
    },
  },
});
