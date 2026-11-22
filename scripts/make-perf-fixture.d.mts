export interface PerfFixtureSpec {
  name: string;
  width: number;
  height: number;
  image: string;
  pins: number;
  folders: number;
}
export const PERF_FIXTURE: PerfFixtureSpec;
export function buildPerfMap(spec?: Partial<PerfFixtureSpec>): unknown;
