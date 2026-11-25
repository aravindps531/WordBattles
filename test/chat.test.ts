import { describe, expect, it } from "vitest";
import { isEmojiOnly } from "../src/client/Chat";

describe("chat", () => {
  it("detects emoji-only messages", () => {
    for (const t of ["👍", "😂😂", "❤️", "👍🏽", "👨‍👩‍👧", " 🎉 "]) expect(isEmojiOnly(t), t).toBe(true);
    for (const t of ["ok 👍", "hello", "123", "#", "", "Nice!"]) expect(isEmojiOnly(t), t).toBe(false);
  });
});
