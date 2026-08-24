import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fixtures = path.resolve("tests/fixtures/raw-animation");
const frameBytes = 16 * 16 * 4;

function decodedCycle(file: string): Buffer[] {
  const result = spawnSync("ffmpeg", [
    "-v", "error",
    // Keep the image demuxer single-pass. TDesktop's clip reader owns the
    // loop boundary and seeks plus flushes the decoder before the next pass.
    "-ignore_loop", "1",
    "-i", path.join(fixtures, file),
    "-frames:v", "2",
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
  expect(result.stdout.byteLength).toBe(frameBytes * 2);
  return [0, 1].map((index) => result.stdout.subarray(
    index * frameBytes,
    (index + 1) * frameBytes,
  ));
}

function decodedFrames(file: string): Buffer[] {
  const first = decodedCycle(file);
  // A second independent pass models the clip reader's EOF path after it
  // seeks to the start and calls avcodec_flush_buffers().
  const restarted = decodedCycle(file);
  return [first[0]!, first[1]!, restarted[0]!];
}

function checksum(frame: Buffer): string {
  return createHash("sha256").update(frame).digest("hex");
}

function pixelFormat(file: string): string {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=pix_fmt",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path.join(fixtures, file),
  ], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffprobe exited with ${result.status}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function premultiplyRgba(frame: Buffer): Buffer {
  const result = Buffer.from(frame);
  for (let index = 0; index < result.length; index += 4) {
    const alpha = result[index + 3]!;
    for (let channel = 0; channel < 3; channel++) {
      result[index + channel] = Math.round((result[index + channel]! * alpha) / 255);
    }
  }
  return result;
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

  it("requires premultiplication for RGBA APNG pixels before Qt composition", () => {
    const fixture = "two-frame-alpha.apng";
    expect(pixelFormat(fixture)).toBe("rgba");

    const straight = decodedFrames(fixture)[0]!;
    const hasLeakingStraightPixel = Array.from({ length: straight.length / 4 }, (_, pixel) => {
      const offset = pixel * 4;
      const alpha = straight[offset + 3]!;
      return alpha < 255 && (
        straight[offset]! > alpha
        || straight[offset + 1]! > alpha
        || straight[offset + 2]! > alpha
      );
    }).some(Boolean);
    expect(hasLeakingStraightPixel).toBe(true);

    const premultiplied = premultiplyRgba(straight);
    for (let offset = 0; offset < premultiplied.length; offset += 4) {
      const alpha = premultiplied[offset + 3]!;
      expect(premultiplied[offset]).toBeLessThanOrEqual(alpha);
      expect(premultiplied[offset + 1]).toBeLessThanOrEqual(alpha);
      expect(premultiplied[offset + 2]).toBeLessThanOrEqual(alpha);
    }
  });
});
