// These components are taken from streamdown.
// @see https://streamdown.ai/
// @see https://github.com/vercel/streamdown
// Thank you Vercel!! Very Cool.

import { type JSX, memo } from "react";
import type { Components } from "react-markdown";
import ShikiHighlighter from "react-shiki";
import { cn } from "../lib/utils";

type MarkdownPoint = { line?: number; column?: number };
type MarkdownPosition = { start?: MarkdownPoint; end?: MarkdownPoint };
type MarkdownNode = {
  position?: MarkdownPosition;
  properties?: { className?: string };
};

type WithNode<T> = T & {
  node?: MarkdownNode;
  children?: React.ReactNode;
  className?: string;
};

function sameNodePosition(prev?: MarkdownNode, next?: MarkdownNode): boolean {
  if (!(prev?.position || next?.position)) {
    return true;
  }
  if (!(prev?.position && next?.position)) {
    return false;
  }

  const prevStart = prev.position.start;
  const nextStart = next.position.start;
  const prevEnd = prev.position.end;
  const nextEnd = next.position.end;

  return (
    prevStart?.line === nextStart?.line &&
    prevStart?.column === nextStart?.column &&
    prevEnd?.line === nextEnd?.line &&
    prevEnd?.column === nextEnd?.column
  );
}

// Helper to compare className and node
function sameClassAndNode(
  prev: { className?: string; node?: MarkdownNode },
  next: { className?: string; node?: MarkdownNode }
) {
  return (
    prev.className === next.className && sameNodePosition(prev.node, next.node)
  );
}

type OlProps = WithNode<JSX.IntrinsicElements["ol"]>;
const MemoOl = memo<OlProps>(
  ({ children, className, node, ...props }: OlProps) => (
    <ol
      className={cn(
        "ml-4 list-outside list-decimal whitespace-normal",
        className
      )}
      {...props}
    >
      {children}
    </ol>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoOl.displayName = "MarkdownOl";

type UlProps = WithNode<JSX.IntrinsicElements["ul"]>;
const MemoUl = memo<UlProps>(
  ({ children, className, node, ...props }: UlProps) => (
    <ul
      className={cn("ml-4 list-outside list-disc whitespace-normal", className)}
      {...props}
    >
      {children}
    </ul>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoUl.displayName = "MarkdownUl";

type LiProps = WithNode<JSX.IntrinsicElements["li"]>;
const MemoLi = memo<LiProps>(
  ({ children, className, node, ...props }: LiProps) => (
    <li className={cn("py-1", className)} {...props}>
      {children}
    </li>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoLi.displayName = "MarkdownLi";

type HrProps = WithNode<JSX.IntrinsicElements["hr"]>;
const MemoHr = memo<HrProps>(
  ({ className, node, ...props }: HrProps) => (
    <hr className={cn("my-6 border-border", className)} {...props} />
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoHr.displayName = "MarkdownHr";

type StrongProps = WithNode<JSX.IntrinsicElements["strong"]>;
const MemoStrong = memo<StrongProps>(
  ({ children, className, node, ...props }: StrongProps) => (
    <strong className={cn("font-semibold", className)} {...props}>
      {children}
    </strong>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoStrong.displayName = "MarkdownStrong";

type EmProps = WithNode<JSX.IntrinsicElements["em"]>;
const MemoEm = memo<EmProps>(
  ({ children, className, node, ...props }: EmProps) => (
    <em className={cn("italic", className)} {...props}>
      {children}
    </em>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoEm.displayName = "MarkdownEm";

type AProps = WithNode<JSX.IntrinsicElements["a"]> & { href?: string };
const MemoA = memo<AProps>(
  ({ children, className, href, node, ...props }: AProps) => (
    <a
      className={cn(
        "wrap-anywhere font-medium text-primary underline",
        className
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  ),
  (p, n) => sameClassAndNode(p, n) && p.href === n.href
);
MemoA.displayName = "MarkdownA";

type HeadingProps<TTag extends keyof JSX.IntrinsicElements> = WithNode<
  JSX.IntrinsicElements[TTag]
>;

const MemoH1 = memo<HeadingProps<"h1">>(
  ({ children, className, node, ...props }) => (
    <h1
      className={cn("mt-6 mb-2 font-semibold text-3xl", className)}
      {...props}
    >
      {children}
    </h1>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoH1.displayName = "MarkdownH1";

const MemoH2 = memo<HeadingProps<"h2">>(
  ({ children, className, node, ...props }) => (
    <h2
      className={cn("mt-6 mb-2 font-semibold text-2xl", className)}
      {...props}
    >
      {children}
    </h2>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoH2.displayName = "MarkdownH2";

const MemoH3 = memo<HeadingProps<"h3">>(
  ({ children, className, node, ...props }) => (
    <h3 className={cn("mt-6 mb-2 font-semibold text-xl", className)} {...props}>
      {children}
    </h3>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoH3.displayName = "MarkdownH3";

const MemoH4 = memo<HeadingProps<"h4">>(
  ({ children, className, node, ...props }) => (
    <h4 className={cn("mt-6 mb-2 font-semibold text-lg", className)} {...props}>
      {children}
    </h4>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoH4.displayName = "MarkdownH4";

const MemoH5 = memo<HeadingProps<"h5">>(
  ({ children, className, node, ...props }) => (
    <h5
      className={cn("mt-6 mb-2 font-semibold text-base", className)}
      {...props}
    >
      {children}
    </h5>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoH5.displayName = "MarkdownH5";

const MemoH6 = memo<HeadingProps<"h6">>(
  ({ children, className, node, ...props }) => (
    <h6 className={cn("mt-6 mb-2 font-semibold text-sm", className)} {...props}>
      {children}
    </h6>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoH6.displayName = "MarkdownH6";

type TableProps = WithNode<JSX.IntrinsicElements["table"]>;
const MemoTable = memo<TableProps>(
  ({ children, className, node, ...props }: TableProps) => (
    <div className="my-4">
      <div className="overflow-x-auto">
        <table
          className={cn(
            "w-full border-collapse border border-border",
            className
          )}
          {...props}
        >
          {children}
        </table>
      </div>
    </div>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoTable.displayName = "MarkdownTable";

type TheadProps = WithNode<JSX.IntrinsicElements["thead"]>;
const MemoThead = memo<TheadProps>(
  ({ children, className, node, ...props }: TheadProps) => (
    <thead className={cn("bg-muted/80", className)} {...props}>
      {children}
    </thead>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoThead.displayName = "MarkdownThead";

type TbodyProps = WithNode<JSX.IntrinsicElements["tbody"]>;
const MemoTbody = memo<TbodyProps>(
  ({ children, className, node, ...props }: TbodyProps) => (
    <tbody
      className={cn("divide-y divide-border bg-muted/40", className)}
      {...props}
    >
      {children}
    </tbody>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoTbody.displayName = "MarkdownTbody";

type TrProps = WithNode<JSX.IntrinsicElements["tr"]>;
const MemoTr = memo<TrProps>(
  ({ children, className, node, ...props }: TrProps) => (
    <tr className={cn("border-border border-b", className)} {...props}>
      {children}
    </tr>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoTr.displayName = "MarkdownTr";

type ThProps = WithNode<JSX.IntrinsicElements["th"]>;
const MemoTh = memo<ThProps>(
  ({ children, className, node, ...props }: ThProps) => (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-2 text-left font-semibold text-sm",
        className
      )}
      {...props}
    >
      {children}
    </th>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoTh.displayName = "MarkdownTh";

type TdProps = WithNode<JSX.IntrinsicElements["td"]>;
const MemoTd = memo<TdProps>(
  ({ children, className, node, ...props }: TdProps) => (
    <td className={cn("px-4 py-2 text-sm", className)} {...props}>
      {children}
    </td>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoTd.displayName = "MarkdownTd";

type BlockquoteProps = WithNode<JSX.IntrinsicElements["blockquote"]>;
const MemoBlockquote = memo<BlockquoteProps>(
  ({ children, className, node, ...props }: BlockquoteProps) => (
    <blockquote
      className={cn(
        "my-4 border-muted-foreground/30 border-l-4 pl-4 text-muted-foreground italic",
        className
      )}
      {...props}
    >
      {children}
    </blockquote>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoBlockquote.displayName = "MarkdownBlockquote";

type SupProps = WithNode<JSX.IntrinsicElements["sup"]>;
const MemoSup = memo<SupProps>(
  ({ children, className, node, ...props }: SupProps) => (
    <sup className={cn("text-sm", className)} {...props}>
      {children}
    </sup>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoSup.displayName = "MarkdownSup";

type SubProps = WithNode<JSX.IntrinsicElements["sub"]>;
const MemoSub = memo<SubProps>(
  ({ children, className, node, ...props }: SubProps) => (
    <sub className={cn("text-sm", className)} {...props}>
      {children}
    </sub>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoSub.displayName = "MarkdownSub";

type ParagraphProps = WithNode<JSX.IntrinsicElements["p"]>;
const MemoParagraph = memo<ParagraphProps>(
  ({ children, className, node, ...props }: ParagraphProps) => (
    <p className={cn("my-2", className)} {...props}>
      {children}
    </p>
  ),
  (p, n) => sameClassAndNode(p, n)
);
MemoParagraph.displayName = "MarkdownParagraph";

type CodeProps = WithNode<JSX.IntrinsicElements["code"]>;
const MemoCode = memo<CodeProps>(
  ({ children, className, node, ...props }: CodeProps) => {
    const codeString = String(children);
    const inline = !codeString.includes("\n");

    if (inline) {
      return (
        <code
          className={cn(
            "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
            className
          )}
          {...props}
        >
          {children}
        </code>
      );
    }

    const cleanCode = codeString.replace(/\n$/, "");
    const match = /language-(\w+)/.exec(className || "");
    const language = match?.[1] || "text";

    return (
      <div className="my-4">
        <ShikiHighlighter
          className={cn("overflow-x-auto rounded-lg border", className)}
          language={language}
          showLanguage={false}
          theme="github-dark-default"
        >
          {cleanCode}
        </ShikiHighlighter>
      </div>
    );
  },
  (p, n) => sameClassAndNode(p, n)
);
MemoCode.displayName = "MarkdownCode";

type PreProps = WithNode<JSX.IntrinsicElements["pre"]>;
const MemoPre = memo<PreProps>(
  ({ children }: PreProps) => <>{children}</>,
  () => true
);
MemoPre.displayName = "MarkdownPre";

type ImgProps = WithNode<JSX.IntrinsicElements["img"]> & {
  src?: string;
  alt?: string;
};
const MemoImg = memo<ImgProps>(
  ({ src, alt, className, node, ...props }: ImgProps) => (
    // biome-ignore lint/correctness/useImageSize: Markdown images have dynamic dimensions
    <img
      alt={alt || ""}
      className={cn("my-4 h-auto max-w-full rounded-lg", className)}
      loading="lazy"
      src={src}
      {...props}
    />
  ),
  (p, n) => sameClassAndNode(p, n) && p.src === n.src && p.alt === n.alt
);
MemoImg.displayName = "MarkdownImg";

export const components: Components = {
  ol: MemoOl,
  ul: MemoUl,
  li: MemoLi,
  hr: MemoHr,
  strong: MemoStrong,
  em: MemoEm,
  a: MemoA,
  h1: MemoH1,
  h2: MemoH2,
  h3: MemoH3,
  h4: MemoH4,
  h5: MemoH5,
  h6: MemoH6,
  table: MemoTable,
  thead: MemoThead,
  tbody: MemoTbody,
  tr: MemoTr,
  th: MemoTh,
  td: MemoTd,
  blockquote: MemoBlockquote,
  sup: MemoSup,
  sub: MemoSub,
  p: MemoParagraph,
  code: MemoCode,
  pre: MemoPre,
  img: MemoImg,
};
