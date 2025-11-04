import { getRepoDOStub } from "@/do/repo";
import { PktLine } from "./pkt";
import type { RefUpdateResult } from "./service";

export async function advertiseCapabilities(
  service: "git-upload-pack" | "git-receive-pack",
  fullRepoName: string
) {
  if (service === "git-upload-pack") {
    const lines = [
      PktLine.encode("version 2\n"),
      PktLine.encode("agent=gitvex/0.0.1\n"),

      PktLine.encode("ls-refs\n"),
      PktLine.encode("fetch\n"),
      PktLine.encode("side-band-64k\n"),
      PktLine.encode("object-format=sha1\n"),
      PktLine.encodeFlush(),
    ];

    const response = PktLine.decodeText(PktLine.mergeLines(lines));
    return new Response(response, {
      status: 200,
      headers: {
        "Content-Type": "application/x-git-upload-pack-advertisement",
        "Cache-Control": "no-cache",
      },
    });
  }

  // TODO: Upgrade to use v2 protocol (Keeping this on old protocol for now because of time constraints, I have exams to study for T_T)
  if (service === "git-receive-pack") {
    const capabilities = [
      "report-status",
      "delete-refs",
      "atomic",
      "no-thin",
      "agent=gitflare/0.0.1",
    ];

    const stub = getRepoDOStub(fullRepoName);
    const { refs, symbolicHead } = await stub.listRefs();

    if (symbolicHead) {
      capabilities.push(`symref=HEAD:${symbolicHead}`);
    }

    const capabilitiesStr = capabilities.join(" ");

    const lines = [
      PktLine.encode("# service=git-receive-pack\n"),
      PktLine.encodeFlush(),
    ];

    if (refs.length > 0) {
      const first = refs[0];
      lines.push(
        PktLine.encode(`${first.oid} ${first.ref}\0${capabilitiesStr}\n`)
      );
      for (let i = 1; i < refs.length; i += 1) {
        lines.push(PktLine.encode(`${refs[i].oid} ${refs[i].ref}\n`));
      }
    } else {
      // Empty repository - advertise capabilities with zero OID
      const zeroOid = "0".repeat(40);
      lines.push(
        PktLine.encode(`${zeroOid} capabilities^{}\0${capabilitiesStr}\n`)
      );
    }

    lines.push(PktLine.encodeFlush());

    const response = PktLine.decodeText(PktLine.mergeLines(lines));
    return new Response(response, {
      status: 200,
      headers: {
        "Content-Type": "application/x-git-receive-pack-advertisement",
        "Cache-Control": "no-cache",
      },
    });
  }
}

export type Command = {
  oldOid: string;
  newOid: string;
  ref: string;
};

export function parseReceivePackRequest(data: Uint8Array) {
  const commands: Command[] = [];
  let capabilities: string[] = [];

  let offset = 0;
  while (offset < data.length) {
    const packet = PktLine.decode(data.subarray(offset));

    const lengthHex = PktLine.decodeText(data.slice(offset, offset + 4));
    const specialPackets = [PktLine.DELIM, PktLine.FLUSH, PktLine.RESPONSE_END];
    const packetLength = specialPackets.includes(lengthHex)
      ? 4
      : Number.parseInt(lengthHex, 16);

    offset += packetLength;

    if (packet.type === "flush") {
      // End of commands, packfile follows
      break;
    }

    if (packet.type === "data") {
      const line = PktLine.decodeText(packet.data).trim();

      // Parse: <old-oid> <new-oid> <ref>\0<capabilities>
      const nullIdx = line.indexOf("\0");
      const refLine = nullIdx >= 0 ? line.substring(0, nullIdx) : line;
      const caps = nullIdx >= 0 ? line.substring(nullIdx + 1).split(" ") : [];

      const parts = refLine.split(" ");
      if (parts.length >= 3) {
        commands.push({
          oldOid: parts[0],
          newOid: parts[1],
          ref: parts[2],
        });
      }

      if (caps.length > 0 && capabilities.length === 0) {
        capabilities = caps;
      }
    }
  }

  const packfile = data.subarray(offset);

  return { commands, capabilities, packfile };
}

export async function buildReportStatus(
  results: RefUpdateResult[],
  unpackOk: boolean
) {
  const lines: Uint8Array[] = [];

  if (unpackOk) {
    lines.push(PktLine.encode("unpack ok\n"));
  } else {
    const error = results.find((r) => r.ref === "*")?.error ?? "unknown error";
    lines.push(PktLine.encode(`unpack ${error}\n`));
  }

  for (const result of results) {
    if (result.ref === "*") continue; // Skip unpack status

    if (result.ok) {
      lines.push(PktLine.encode(`ok ${result.ref}\n`));
    } else {
      lines.push(PktLine.encode(`ng ${result.ref} ${result.error}\n`));
    }
  }

  lines.push(PktLine.encodeFlush());

  return new Response(PktLine.decodeText(PktLine.mergeLines(lines)), {
    status: 200,
    headers: {
      "Content-Type": "application/x-git-receive-pack-result",
      "Cache-Control": "no-cache",
    },
  });
}
