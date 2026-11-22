import { describe, expect, it } from "vitest";
import { buildLaunchRequest, parseLaunchResponse } from "./generic-aggregator.ts";
import { hmacHex } from "../signature.ts";

const ctx = {
  session_id: "s1", user_id: "u1", username: "player_a1", locale: "sq", external_game_id: "vs20demo",
  api_base_url: "https://api.aggregator.example", config: { operator_id: "op1", launch_path: "/v2/launch", extra: { mode: "real" } },
};

describe("generic aggregator", () => {
  it("builds a signed, server-to-server launch request", async () => {
    const r = await buildLaunchRequest(ctx, "tok", "key123", { returnUrl: "https://app/casino", now: 1_700_000_000_000 });
    expect(r.url).toBe("https://api.aggregator.example/v2/launch");
    const body = JSON.parse(r.init.body);
    expect(body).toMatchObject({ operator_id: "op1", game_id: "vs20demo", session_token: "tok", currency: "CR", language: "sq", mode: "real" });
    expect(r.init.headers["x-signature"]).toBe(await hmacHex("key123", `1700000000.${r.init.body}`));
  });
  it("reads the game URL from common response shapes and rejects non-https", () => {
    expect(parseLaunchResponse({ url: "https://g.example/1" })).toBe("https://g.example/1");
    expect(parseLaunchResponse({ data: { url: "https://g.example/2" } })).toBe("https://g.example/2");
    expect(parseLaunchResponse({ result: { link: "https://g.example/3" } }, "result.link")).toBe("https://g.example/3");
    expect(() => parseLaunchResponse({ url: "http://evil" })).toThrow("PROVIDER_BAD_RESPONSE");
    expect(() => parseLaunchResponse({})).toThrow("PROVIDER_BAD_RESPONSE");
  });
});
