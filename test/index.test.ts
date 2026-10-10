import { describe, expect, it } from "vitest";
import {
  accelerate,
  unvestedShares,
  vestedShares,
  vestingSchedule,
} from "../src/index.js";
import { CASES } from "./fixtures.js";

const STANDARD = { shares: 4800, startDate: "2026-01-15", totalMonths: 48, cliffMonths: 12 };

describe("the standard 4-year grant with 1-year cliff", () => {
  it("cliff vests 25% exactly, then monthly tranches", () => {
    const s = vestingSchedule(STANDARD);
    expect(s[0]).toEqual({ date: "2027-01-15", shares: 1200, cumulative: 1200, isCliff: true });
    expect(s).toHaveLength(1 + 36); // cliff + 36 monthly
    expect(s[1]!.date).toBe("2027-02-15");
    expect(s[1]!.shares).toBe(100);
    expect(s[s.length - 1]!.date).toBe("2030-01-15");
    expect(s[s.length - 1]!.cumulative).toBe(4800);
  });

  it("total always equals the grant exactly (no share leaks)", () => {
    const s = vestingSchedule(STANDARD);
    const sum = s.reduce((a, t) => a + t.shares, 0);
    expect(sum).toBe(4800);
  });

  it("vestedShares: zero before cliff, cliff amount at cliff, full at end", () => {
    expect(vestedShares(STANDARD, "2026-12-31")).toBe(0);
    expect(vestedShares(STANDARD, "2027-01-15")).toBe(1200);
    expect(vestedShares(STANDARD, "2027-01-14")).toBe(0);
    expect(vestedShares(STANDARD, "2028-01-15")).toBe(2400); // halfway
    expect(vestedShares(STANDARD, "2030-01-15")).toBe(4800);
    expect(vestedShares(STANDARD, "2035-01-01")).toBe(4800);
    expect(unvestedShares(STANDARD, "2028-01-15")).toBe(2400);
  });
});

describe("fractional-share convention (round down, true-up at the end)", () => {
  it("handles a grant not divisible by months", () => {
    // 1000 shares over 48 months = 20.833.../month
    const g = { shares: 1000, startDate: "2026-01-01", totalMonths: 48, cliffMonths: 12 };
    const s = vestingSchedule(g);
    expect(s[0]!.shares).toBe(250); // floor(1000 * 12/48) = 250 exactly
    // every tranche is a whole number and cumulative never exceeds exact accrual
    for (const t of s) {
      expect(Number.isInteger(t.shares)).toBe(true);
      expect(t.shares).toBeGreaterThanOrEqual(0);
    }
    expect(s[s.length - 1]!.cumulative).toBe(1000); // true-up
    expect(s.reduce((a, t) => a + t.shares, 0)).toBe(1000);
  });

  it("cumulative is a floor of exact linear accrual at every tranche", () => {
    const g = { shares: 997, startDate: "2026-01-01", totalMonths: 48, cliffMonths: 12 };
    const s = vestingSchedule(g);
    let monthsSeen = 12;
    for (const t of s) {
      const exact = (997 * monthsSeen) / 48;
      if (monthsSeen < 48) {
        expect(t.cumulative).toBe(Math.floor(exact));
      } else {
        expect(t.cumulative).toBe(997);
      }
      monthsSeen += 1;
    }
  });
});

describe("month-end clamping", () => {
  it("a Jan 31 grant vests on Feb 28 (or 29)", () => {
    const g = { shares: 480, startDate: "2026-01-31", totalMonths: 48, cliffMonths: 0 };
    const s = vestingSchedule(g);
    expect(s[0]!.date).toBe("2026-02-28"); // 2026 not a leap year
    expect(s[1]!.date).toBe("2026-03-31"); // back to the 31st when the month has one
    // Feb 2028 IS a leap year
    const feb2028 = s.find((t) => t.date.startsWith("2028-02"));
    expect(feb2028!.date).toBe("2028-02-29");
  });
});

describe("frequencies and no-cliff schedules", () => {
  it("quarterly after cliff", () => {
    const g = {
      shares: 4800,
      startDate: "2026-01-01",
      totalMonths: 48,
      cliffMonths: 12,
      frequency: "quarterly" as const,
    };
    const s = vestingSchedule(g);
    expect(s).toHaveLength(1 + 12); // cliff + 12 quarters
    expect(s[1]!.date).toBe("2027-04-01");
    expect(s[1]!.shares).toBe(300); // 4800/48*3
    expect(s[s.length - 1]!.cumulative).toBe(4800);
  });

  it("no cliff vests monthly from the first month", () => {
    const g = { shares: 48, startDate: "2026-01-01", totalMonths: 48 };
    const s = vestingSchedule(g);
    expect(s[0]).toEqual({ date: "2026-02-01", shares: 1, cumulative: 1, isCliff: false });
    expect(s).toHaveLength(48);
  });

  it("rejects a frequency that does not divide the post-cliff period", () => {
    expect(() =>
      vestingSchedule({
        shares: 100,
        startDate: "2026-01-01",
        totalMonths: 47,
        cliffMonths: 12,
        frequency: "quarterly",
      }),
    ).toThrow(RangeError);
  });
});

describe("acceleration", () => {
  it("full single-trigger accelerates everything unvested", () => {
    const r = accelerate({ grant: STANDARD, asOf: "2028-01-15", acceleration: 1 });
    expect(r.vestedBefore).toBe(2400);
    expect(r.accelerated).toBe(2400);
    expect(r.vestedAfter).toBe(4800);
    expect(r.remainingUnvested).toBe(0);
  });

  it("50% acceleration takes half the unvested (floored)", () => {
    const r = accelerate({ grant: STANDARD, asOf: "2028-01-15", acceleration: 0.5 });
    expect(r.accelerated).toBe(1200);
    expect(r.remainingUnvested).toBe(1200);
  });

  it("months-based acceleration pulls the schedule forward", () => {
    const r = accelerate({ grant: STANDARD, asOf: "2028-01-15", acceleration: { months: 12 } });
    expect(r.accelerated).toBe(1200); // 12 more months at 100/month
    expect(r.vestedAfter).toBe(3600);
  });

  it("months acceleration caps at the grant total", () => {
    const r = accelerate({ grant: STANDARD, asOf: "2029-06-15", acceleration: { months: 24 } });
    expect(r.vestedAfter).toBe(4800);
  });

  it("rejects bad fractions", () => {
    expect(() => accelerate({ grant: STANDARD, asOf: "2028-01-15", acceleration: 1.5 })).toThrow(
      RangeError,
    );
  });
});

describe("validation", () => {
  it("rejects bad inputs", () => {
    expect(() => vestingSchedule({ shares: 0, startDate: "2026-01-01", totalMonths: 48 })).toThrow();
    expect(() => vestingSchedule({ shares: 10.5 as never, startDate: "2026-01-01", totalMonths: 48 })).toThrow();
    expect(() => vestingSchedule({ shares: 100, startDate: "2026-13-01", totalMonths: 48 })).toThrow();
    expect(() =>
      vestingSchedule({ shares: 100, startDate: "2026-01-01", totalMonths: 48, cliffMonths: 60 }),
    ).toThrow();
  });
});

describe("floating-point exactness (regressions)", () => {
  it("floors exact integer accrual correctly (84 shares / 60 months, month 45 = 63)", () => {
    // 84/60 × 45 evaluates to 62.99999999999999 in floating point.
    const s = vestingSchedule({ shares: 84, startDate: "2026-01-01", totalMonths: 60 });
    expect(s[44]!.cumulative).toBe(63);
  });

  it("does not lose a share on decimal acceleration fractions (800 × 0.29 = 232)", () => {
    const grant = { shares: 4800, startDate: "2026-01-01", totalMonths: 48 };
    const r = accelerate({ grant, asOf: "2029-05-01", acceleration: 0.29 });
    expect(r.vestedBefore).toBe(4000);
    expect(r.accelerated).toBe(232);
  });

  it("rejects share counts too large for exact integer math", () => {
    expect(() =>
      vestingSchedule({ shares: Number.MAX_SAFE_INTEGER, startDate: "2026-01-01", totalMonths: 48 }),
    ).toThrow(RangeError);
  });

  it("validates dates in years 0–99 without Date.UTC's 19xx remapping", () => {
    expect(() => vestingSchedule({ shares: 12, startDate: "0004-02-29", totalMonths: 12 })).not.toThrow();
    expect(() => vestingSchedule({ shares: 12, startDate: "0100-02-29", totalMonths: 12 })).toThrow(RangeError);
  });
});

describe("independent reference fixtures (python-dateutil + exact rationals)", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const s = vestingSchedule(c.grant).map((t) => [t.date, t.shares, t.cumulative, t.isCliff]);
    expect(s).toEqual(c.schedule);
    for (const [asOf, vested] of c.probes) expect(vestedShares(c.grant, asOf)).toBe(vested);
    for (const [asOf, frac, months, want] of c.accel) {
      const r = accelerate({ grant: c.grant, asOf, acceleration: frac !== null ? frac : { months: months! } });
      expect(r.accelerated).toBe(want);
    }
  });
});
