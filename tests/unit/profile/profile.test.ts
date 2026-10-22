import { afterEach, describe, expect, it, vi } from "vitest";
import { profileInitials } from "@/lib/profile";

const mocks = vi.hoisted(() => ({
  userId: "profile-user",
  updatedNames: [] as string[],
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: mocks.userId } }),
      updateUser: async ({ body }: { body: { name: string } }) => {
        mocks.updatedNames.push(body.name);
        return { user: { id: mocks.userId, name: body.name } };
      },
    },
  },
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { updateProfileName } = await import("@/lib/events/actions");

afterEach(() => {
  mocks.updatedNames.length = 0;
});

describe("profileInitials", () => {
  it("uses up to two name initials and falls back to email", () => {
    expect(profileInitials("Ada Lovelace", "ada@example.test")).toBe("AL");
    expect(profileInitials("  Prince  ", "p@example.test")).toBe("P");
    expect(profileInitials(" ", "ada@example.test")).toBe("A");
    expect(profileInitials(" ", " ")).toBe("?");
  });
});

describe("updateProfileName", () => {
  it("trims the display name and persists it through Better Auth", async () => {
    await expect(updateProfileName("  Ada Lovelace  ")).resolves.toEqual({
      ok: true,
      name: "Ada Lovelace",
    });
    expect(mocks.updatedNames).toEqual(["Ada Lovelace"]);
  });

  it("rejects blank and overlong names on the server", async () => {
    await expect(updateProfileName("  ")).resolves.toMatchObject({ ok: false });
    await expect(updateProfileName("x".repeat(81))).resolves.toMatchObject({ ok: false });
    expect(mocks.updatedNames).toEqual([]);
  });
});
