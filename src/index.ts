/**
 * vesting-schedule-math — equity vesting schedules as pure math.
 *
 * The standard startup grant (4-year monthly with a 1-year cliff) plus
 * quarterly/annual frequencies, explicit fractional-share conventions
 * (round down per tranche, remainder trued-up in the final tranche), vested
 * amounts as of any date, and single/double-trigger acceleration.
 *
 * Month arithmetic clamps to month end (a Jan 31 grant vests on Feb 28/29),
 * matching cap-table platform behavior.
 */

export type Frequency = "monthly" | "quarterly" | "annual";

export interface VestingGrant {
  /** Total shares in the grant. */
  shares: number;
  /** Vesting commencement date, YYYY-MM-DD. */
  startDate: string;
  /** Total vesting length in months (48 for the standard grant). */
  totalMonths: number;
  /** Cliff length in months (12 standard; 0 = no cliff). */
  cliffMonths?: number;
  /** Tranche frequency after the cliff. Default "monthly". */
  frequency?: Frequency;
}

export interface Tranche {
  /** Vest date, YYYY-MM-DD. */
  date: string;
  /** Shares vesting on this date. */
  shares: number;
  /** Cumulative shares vested through this date. */
  cumulative: number;
  /** True for the cliff tranche. */
  isCliff: boolean;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface YMD {
  y: number;
  m: number;
  d: number;
}

function toYMD(input: string, label: string): YMD {
  const m = DATE_RE.exec(input);
  if (!m) throw new RangeError(`Invalid ${label}: "${input}" (expected YYYY-MM-DD)`);
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const check = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  if (
    check.getUTCFullYear() !== ymd.y ||
    check.getUTCMonth() + 1 !== ymd.m ||
    check.getUTCDate() !== ymd.d
  ) {
    throw new RangeError(`Invalid calendar date for ${label}: "${input}"`);
  }
  return ymd;
}

function iso(a: YMD): string {
  return `${String(a.y).padStart(4, "0")}-${String(a.m).padStart(2, "0")}-${String(a.d).padStart(2, "0")}`;
}

/** Add months, clamping the day to the target month's end (Jan 31 + 1M = Feb 28). */
function addMonthsClamped(a: YMD, months: number): YMD {
  const total = a.y * 12 + (a.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: Math.min(a.d, lastDay) };
}

const FREQ_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, annual: 12 };

function validate(grant: VestingGrant): { cliff: number; freq: number } {
  if (!Number.isInteger(grant.shares) || grant.shares <= 0) {
    throw new RangeError(`shares must be a positive integer, got ${grant.shares}`);
  }
  if (!Number.isInteger(grant.totalMonths) || grant.totalMonths <= 0) {
    throw new RangeError(`totalMonths must be a positive integer, got ${grant.totalMonths}`);
  }
  const cliff = grant.cliffMonths ?? 0;
  if (!Number.isInteger(cliff) || cliff < 0 || cliff > grant.totalMonths) {
    throw new RangeError(`cliffMonths must be an integer in 0–totalMonths, got ${cliff}`);
  }
  const freq = FREQ_MONTHS[grant.frequency ?? "monthly"];
  if ((grant.totalMonths - cliff) % freq !== 0) {
    throw new RangeError(
      `totalMonths minus cliff (${grant.totalMonths - cliff}) must be a multiple of the frequency (${freq} months)`,
    );
  }
  toYMD(grant.startDate, "startDate");
  return { cliff, freq };
}

/**
 * The full tranche-by-tranche schedule.
 *
 * Convention: vesting accrues linearly per month; each tranche is rounded
 * DOWN to a whole share and the remainder carries forward, so cumulative
 * vesting never overstates, and the final tranche trues-up to the full grant.
 *
 * ```ts
 * vestingSchedule({ shares: 4800, startDate: "2026-01-15", totalMonths: 48, cliffMonths: 12 });
 * // 37 tranches: cliff of 1200 on 2027-01-15, then 100/month
 * ```
 */
export function vestingSchedule(grant: VestingGrant): Tranche[] {
  const { cliff, freq } = validate(grant);
  const start = toYMD(grant.startDate, "startDate");
  const perMonth = grant.shares / grant.totalMonths;

  const tranches: Tranche[] = [];
  let cumulative = 0;

  const pushTranche = (monthsElapsed: number, isCliff: boolean) => {
    // Exact accrual through monthsElapsed, floored; tranche = accrual − already vested.
    const accrued =
      monthsElapsed >= grant.totalMonths
        ? grant.shares
        : Math.floor(perMonth * monthsElapsed);
    const shares = accrued - cumulative;
    cumulative = accrued;
    tranches.push({ date: iso(addMonthsClamped(start, monthsElapsed)), shares, cumulative, isCliff });
  };

  if (cliff > 0) pushTranche(cliff, true);
  for (let m = (cliff > 0 ? cliff : 0) + freq; m <= grant.totalMonths; m += freq) {
    pushTranche(m, false);
  }
  // No-cliff schedules start vesting at the first frequency interval; if cliff
  // is 0 the loop above already began at `freq`.
  return tranches;
}

/**
 * Shares vested as of a date (inclusive). Before the cliff this is 0.
 */
export function vestedShares(grant: VestingGrant, asOf: string): number {
  toYMD(asOf, "asOf");
  const schedule = vestingSchedule(grant);
  let vested = 0;
  for (const t of schedule) {
    if (t.date <= asOf) vested = t.cumulative;
    else break;
  }
  return vested;
}

/** Unvested shares as of a date. */
export function unvestedShares(grant: VestingGrant, asOf: string): number {
  return grant.shares - vestedShares(grant, asOf);
}

export interface AccelerationParams {
  grant: VestingGrant;
  /** Date the acceleration triggers (e.g. closing or termination date). */
  asOf: string;
  /**
   * Portion of the UNVESTED shares that accelerate: 1 for full single/double
   * trigger, 0.5 for 50% acceleration, or `{ months: n }` to accelerate the
   * next n months of the schedule.
   */
  acceleration: number | { months: number };
}

export interface AccelerationResult {
  vestedBefore: number;
  accelerated: number;
  vestedAfter: number;
  remainingUnvested: number;
}

/**
 * Apply single/double-trigger acceleration at a date.
 *
 * ```ts
 * accelerate({ grant, asOf: "2027-06-30", acceleration: 1 });      // full
 * accelerate({ grant, asOf: "2027-06-30", acceleration: 0.5 });    // 50% of unvested
 * accelerate({ grant, asOf: "2027-06-30", acceleration: { months: 12 } }); // next 12 months
 * ```
 */
export function accelerate(params: AccelerationParams): AccelerationResult {
  const { grant, asOf, acceleration } = params;
  const vestedBefore = vestedShares(grant, asOf);
  const unvested = grant.shares - vestedBefore;

  let accelerated: number;
  if (typeof acceleration === "number") {
    if (!(acceleration >= 0 && acceleration <= 1)) {
      throw new RangeError(`acceleration fraction must be in [0,1], got ${acceleration}`);
    }
    accelerated = Math.floor(unvested * acceleration);
  } else {
    const months = acceleration.months;
    if (!Number.isInteger(months) || months < 0) {
      throw new RangeError(`acceleration.months must be a non-negative integer, got ${months}`);
    }
    // Vested if the clock ran `months` further, minus what's vested now.
    const asOfY = toYMD(asOf, "asOf");
    const future = iso(addMonthsClamped(asOfY, months));
    accelerated = Math.min(unvested, vestedShares(grant, future) - vestedBefore);
  }
  const vestedAfter = vestedBefore + accelerated;
  return { vestedBefore, accelerated, vestedAfter, remainingUnvested: grant.shares - vestedAfter };
}
