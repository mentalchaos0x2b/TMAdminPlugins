import { describe, it, expect } from "vitest";
import { appendPayloadToLines, parseAnsiToSpans, stripAnsi } from "./terminalBuffer";

describe("terminalBuffer", () => {
  it("normalizes CRLF without adding extra blank lines", () => {
    const lines = appendPayloadToLines([], {
      seq: 1,
      data: "line1\r\nline2\r\n",
      stream: "stdout",
    });

    expect(lines.map((l) => l.raw)).toEqual(["line1", "line2"]);
    expect(lines.every((l) => !l.incomplete)).toBe(true);
  });

  it("handles split CR and LF across consecutive PTY chunks without blank lines", () => {
    let lines = appendPayloadToLines([], {
      seq: 1,
      data: "hello\r",
      stream: "stdout",
    });
    expect(lines.map((l) => l.raw)).toEqual(["hello"]);
    expect(lines[0]?.incomplete).toBe(true);

    lines = appendPayloadToLines(lines, {
      seq: 2,
      data: "\nworld\r\n",
      stream: "stdout",
    });
    expect(lines.map((l) => l.raw)).toEqual(["hello", "world"]);
    expect(lines.every((l) => !l.incomplete)).toBe(true);
  });

  it("collapses multiple CR before LF (e.g. \\r\\r\\n) into a single newline", () => {
    const lines = appendPayloadToLines([], {
      seq: 1,
      data: "first\r\r\nsecond\r\n",
      stream: "stdout",
    });

    expect(lines.map((l) => l.raw)).toEqual(["first", "second"]);
  });

  it("treats standalone CR as carriage return overwriting current line", () => {
    const lines = appendPayloadToLines([], {
      seq: 1,
      data: "Progress 10%\rProgress 50%\rProgress 100%\r\nDone\r\n",
      stream: "stdout",
    });

    expect(lines.map((l) => l.raw)).toEqual(["Progress 100%", "Done"]);
  });

  it("preserves visible content when CR is followed only by trailing CR or ANSI reset", () => {
    let lines = appendPayloadToLines([], {
      seq: 1,
      data: "\x1b[32mReady\r\x1b[0m",
      stream: "stdout",
    });
    expect(lines.map((l) => l.raw)).toEqual(["Ready"]);

    lines = appendPayloadToLines(lines, {
      seq: 2,
      data: "\nNext\r",
      stream: "stdout",
    });
    expect(lines.map((l) => l.raw)).toEqual(["Ready", "Next"]);
  });

  it("preserves ANSI SGR styles across split CR chunks", () => {
    let lines = appendPayloadToLines([], {
      seq: 1,
      data: "old\r\x1b[32m",
      stream: "stdout",
    });
    lines = appendPayloadToLines(lines, {
      seq: 2,
      data: "green\x1b[0m\r\n",
      stream: "stdout",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.raw).toBe("green");
    expect(lines[0]?.spans).toEqual([{ text: "green", color: "#3fb950" }]);
  });

  it("keeps intentional empty lines as single empty entries and enforces maxLines", () => {
    const lines = appendPayloadToLines(
      [],
      {
        seq: 1,
        data: "a\r\n\r\nb\r\nc\r\n",
        stream: "stdout",
      },
      3,
    );

    expect(lines.map((l) => l.raw)).toEqual(["", "b", "c"]);
    expect(parseAnsiToSpans("")).toEqual([]);
    expect(stripAnsi("\x1b[31merr\x1b[0m")).toBe("err");
  });
});
