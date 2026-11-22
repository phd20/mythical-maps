export interface FixtureSize {
  name: string;
  width: number;
  height: number;
}

export const FIXTURES: FixtureSize[];
export function crc32(...bufs: Uint8Array[]): number;
export function writeFixturePng(file: string, width: number, height: number): Promise<void>;
export function generateFixtureImages(outDir: string, sizes?: FixtureSize[]): Promise<string[]>;
