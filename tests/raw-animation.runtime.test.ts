import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fixtures = path.resolve("tests/fixtures/raw-animation");
const frameBytes = 16 * 16 * 4;

function decodedFrames(file: string): Buffer[] {
  const result = spawnSync("ffmpeg", [
    "-v", "error",
    // This is the same demuxer option installed in TDesktop's clip reader.
    "-ignore_loop", "0",
    "-i", path.join(fixtures, file),
    "-frames:v", "3",
    "-vsync", "0",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "pipe:1",
  ], {
    encoding: null,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with ${result.status}: ${result.stderr.toString("utf8")}`);
  }
  expect(result.stdout.byteLength).toBe(frameBytes * 3);
  return [0, 1, 2].map((index) => result.stdout.subarray(
    index * frameBytes,
    (index + 1) * frameBytes,
  ));
}

function checksum(frame: Buffer): string {
  return createHash("sha256").update(frame).digest("hex");
}

describe("Desktop FFmpeg raw animation runtime", () => {
  for (const fixture of [
    { name: "two-frame.gif", label: "GIF", alpha: false },
    { name: "two-frame.apng", label: "APNG RGB", alpha: false },
    { name: "two-frame-apng-as-jpg.jpg", label: "APNG bytes with a .jpg name", alpha: false },
    { name: "two-frame-alpha.apng", label: "APNG RGBA", alpha: true },
  ]) {
    it(`decodes and loops two changing ${fixture.label} frames as A-B-A`, () => {
      const frames = decodedFrames(fixture.name);
      const hashes = frames.map(checksum);
      expect(hashes[0]).not.toBe(hashes[1]);
      expect(hashes[2]).toBe(hashes[0]);
      if (fixture.alpha) {
        const alpha = frames[0]!.filter((_, index) => index % 4 === 3);
        expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
      }
    });
  }
});
