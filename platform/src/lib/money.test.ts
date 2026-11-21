import { describe, expect, it } from "vitest";
import { formatCredits, parseCredits, potentialReturn, totalOdds } from "./money";

describe("money", () => {
  it("formats units as credits without floats", () => {
    expect(formatCredits(123456)).toBe("1,234.56 Cr");
    expect(formatCredits("5")).toBe("0.05 Cr");
    expect(formatCredits(-250n, { suffix: false })).toBe("-2.50");
    expect(formatCredits("90071992547409910")).toBe("900,719,925,474,099.10 Cr");
  });
  it("parses user input into units", () => {
    expect(parseCredits("10")).toBe(1000n);
    expect(parseCredits("10.5")).toBe(1050n);
    expect(parseCredits("10,25")).toBe(1025n);
    expect(parseCredits("1,000")).toBe(100000n);
    expect(parseCredits("0.001")).toBeNull();
    expect(parseCredits("-5")).toBeNull();
    expect(parseCredits("1e5")).toBeNull();
  });
  it("computes potential returns like the database (floor)", () => {
    expect(potentialReturn(200n, ["2.00"])).toBe(400n);
    expect(potentialReturn(100n, ["2.00", "2.50"])).toBe(500n);
    expect(potentialReturn(333n, ["1.95"])).toBe(649n);
    expect(totalOdds(["2.00", "2.50"])).toBe("5.00");
  });
});
