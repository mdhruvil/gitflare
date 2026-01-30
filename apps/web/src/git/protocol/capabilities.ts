import { PktLine } from "@/git/pkt";

export type Ref = {
  name: string;
  oid: string;
};

const RECEIVE_PACK_CAPABILITIES = [
  "report-status",
  "delete-refs",
  "atomic",
  "side-band-64k",
  "agent=gitflare/0.0.1",
];

const ZERO_OID = "0".repeat(40);

/**
 * Build capability advertisement for receive-pack service.
 * Used in response to /info/refs?service=git-receive-pack.
 */
export function advertiseReceivePackCapabilities(
  refs: Ref[],
  symbolicHead: string | null
): Uint8Array {
  const capabilities = [...RECEIVE_PACK_CAPABILITIES];

  if (symbolicHead) {
    capabilities.push(`symref=HEAD:${symbolicHead}`);
  }

  const capabilitiesStr = capabilities.join(" ");

  const lines: Uint8Array[] = [
    PktLine.encode("# service=git-receive-pack\n"),
    PktLine.encodeFlush(),
  ];

  if (refs.length > 0) {
    const first = refs[0];
    lines.push(
      PktLine.encode(`${first.oid} ${first.name}\0${capabilitiesStr}\n`)
    );

    for (let i = 1; i < refs.length; i += 1) {
      lines.push(PktLine.encode(`${refs[i].oid} ${refs[i].name}\n`));
    }
  } else {
    lines.push(
      PktLine.encode(`${ZERO_OID} capabilities^{}\0${capabilitiesStr}\n`)
    );
  }

  lines.push(PktLine.encodeFlush());

  return PktLine.mergeLines(lines);
}
