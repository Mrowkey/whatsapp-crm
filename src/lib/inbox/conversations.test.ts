import { describe, it, expect } from "vitest";
import {
  matchesContactFilters,
  normalizeConversation,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

describe("inbox views", () => {
  const conv = (over: Partial<Conversation>): Conversation => ({
    ...makeConversation(null),
    ...over,
  });
  const list = [
    conv({ id: "a", unread_count: 2, assigned_agent_id: "me" }),
    conv({ id: "b", unread_count: 0, assigned_agent_id: "other" }),
    conv({ id: "c", unread_count: 1 }),
  ];

  it("matches each view", async () => {
    const { matchesInboxView } = await import("./conversations");
    expect(list.filter((c) => matchesInboxView(c, "all", "me"))).toHaveLength(3);
    expect(
      list.filter((c) => matchesInboxView(c, "unread", "me")).map((c) => c.id),
    ).toEqual(["a", "c"]);
    expect(
      list.filter((c) => matchesInboxView(c, "mine", "me")).map((c) => c.id),
    ).toEqual(["a"]);
    expect(
      list
        .filter((c) => matchesInboxView(c, "unassigned", "me"))
        .map((c) => c.id),
    ).toEqual(["c"]);
  });

  it("never matches 'mine' without a signed-in user", async () => {
    const { matchesInboxView } = await import("./conversations");
    expect(list.some((c) => matchesInboxView(c, "mine", null))).toBe(false);
  });

  it("counts every view in one pass", async () => {
    const { countInboxViews } = await import("./conversations");
    expect(countInboxViews(list, "me")).toEqual({
      all: 3,
      unread: 2,
      mine: 1,
      unassigned: 1,
    });
  });
});

describe("formatConversationTime", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("uses compact relative units inside a day", async () => {
    const { formatConversationTime } = await import("./conversations");
    expect(formatConversationTime("2026-03-10T11:59:40Z", now)).toBe("now");
    expect(formatConversationTime("2026-03-10T11:55:00Z", now)).toBe("5m");
    expect(formatConversationTime("2026-03-10T09:00:00Z", now)).toBe("3h");
  });

  it("returns an empty string for missing or invalid input", async () => {
    const { formatConversationTime } = await import("./conversations");
    expect(formatConversationTime(undefined, now)).toBe("");
    expect(formatConversationTime("not-a-date", now)).toBe("");
  });
});
