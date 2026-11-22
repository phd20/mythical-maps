export type CssNode =
  | { kind: "rule"; selectors: string[]; declarations: string[] }
  | { kind: "at"; prelude: string; children: CssNode[] };

export const SCOPE: string;
export const BEGIN_MARKER: string;
export const END_MARKER: string;
export const GEOMAN_BEGIN_MARKER: string;
export const GEOMAN_END_MARKER: string;
export const GEOMAN_CSS: string;
export const LEAFLET_CSS: string;
export const STYLES_CSS: string;
export function parseCss(css: string): CssNode[];
export function allSelectors(nodes: CssNode[]): string[];
export function scopeSelector(selector: string): string;
export function scopeLeafletCss(css: string): string;
export function spliceGenerated(styles: string, generated: string, begin?: string, end?: string): string;
export function expectedStyles(stylesText?: string, leafletText?: string, geomanText?: string): string;
