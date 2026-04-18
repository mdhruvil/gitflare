import type { FileDiffOptions, FileOptions } from "@pierre/diffs";

/**
 * Shared configuration for @pierre/diffs components.
 * Used both server-side (SSR preloading) and client-side (React components).
 */

const FONT_FAMILY =
  '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const SHARED_UNSAFE_CSS = `
[data-diff],
[data-file] {
  border-radius: 0;
}
`;

/** Base options shared across all diff components */
const SHARED_DIFF_OPTIONS = {
  theme: "pierre-dark",
  themeType: "dark",
  diffStyle: "unified",
  diffIndicators: "bars",
  lineDiffType: "word",
  hunkSeparators: "line-info-basic",
  overflow: "scroll",
  unsafeCSS: SHARED_UNSAFE_CSS,
} as const;

/** Diff options with the library's built-in file header */
export const diffOptionsWithHeader = {
  ...SHARED_DIFF_OPTIONS,
  disableFileHeader: false,
} as const satisfies FileDiffOptions<never>;

/** Diff options with file header disabled */
export const diffOptions = {
  ...SHARED_DIFF_OPTIONS,
  disableFileHeader: true,
} as const satisfies FileDiffOptions<never>;

/** Options for file viewer components (File) */
export const fileOptions = {
  theme: "pierre-dark",
  themeType: "dark",
  disableFileHeader: true,
  overflow: "scroll",
  unsafeCSS: SHARED_UNSAFE_CSS,
} as const satisfies FileOptions<never>;

/** CSS variables applied to wrapper elements for consistent font sizing */
export const diffsStyleVariables: Record<string, string | number> = {
  "--diffs-font-family": FONT_FAMILY,
  "--diffs-font-size": "14px",
  "--diffs-line-height": "20px",
  "--diffs-tab-size": 2,
};
