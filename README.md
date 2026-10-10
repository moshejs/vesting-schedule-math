# vesting-schedule-math

Equity **vesting schedule** math — cliff + monthly/quarterly/annual tranches, exact **fractional-share conventions**, vested-as-of queries, and **single/double-trigger acceleration**. Zero dependencies.

```
npm install vesting-schedule-math
```

## Why

Every cap-table tool, offer-letter calculator, and equity dashboard rebuilds the same schedule math — and the details bite: what does a January 31 grant vest on in February? Where do the fractional shares go when 1,000 shares don't divide by 48 months? npm had nothing for it. This package encodes the standard conventions: month-end clamping, round-down-per-tranche with a final true-up (cumulative vesting never overstates and always sums exactly to the grant), and the acceleration variants term sheets actually use.

```ts
import { vestingSchedule, vestedShares, accelerate } from "vesting-schedule-math";

const grant = { shares: 4800, startDate: "2026-01-15", totalMonths: 48, cliffMonths: 12 };

vestingSchedule(grant);
// [{ date: "2027-01-15", shares: 1200, isCliff: true }, then 100/month × 36]

vestedShares(grant, "2028-01-15");   // 2400 — halfway

accelerate({ grant, asOf: "2028-01-15", acceleration: 0.5 });
// { vestedBefore: 2400, accelerated: 1200, vestedAfter: 3600, remainingUnvested: 1200 }
```

## API

- **`vestingSchedule(grant)`** — the full tranche list `{ date, shares, cumulative, isCliff }[]`. `grant`: `{ shares, startDate, totalMonths, cliffMonths?, frequency? }` (`"monthly"` default, `"quarterly"`, `"annual"`).
- **`vestedShares(grant, asOf)`** / **`unvestedShares(grant, asOf)`**.
- **`accelerate({ grant, asOf, acceleration })`** — `acceleration` is a fraction of unvested (`1` = full trigger, `0.5` = half) or `{ months: n }` to pull the schedule forward n months.

Conventions: months clamp to month-end (Jan 31 → Feb 28/29); every tranche is a whole number of shares, rounded down against exact linear accrual, with the final tranche truing up — the invariant `sum(tranches) === grant.shares` always holds. All rounding is done in exact integer arithmetic (cumulative vested = `floor(shares × months / totalMonths)`), so there are no off-by-one-share floating-point errors; fractional acceleration is likewise floored (`floor(unvested × fraction)`). Invalid inputs throw `RangeError`, including share counts where `shares × totalMonths` exceeds `Number.MAX_SAFE_INTEGER`.

Not modeled: early exercise / repurchase, performance-based vesting, and leave-of-absence pauses.

## Related

Part of a cap-table math family: [`safe-stack-conversion`](https://github.com/moshejs/safe-stack-conversion) · [`priced-round-math`](https://github.com/moshejs/priced-round-math) · [`exit-waterfall`](https://github.com/moshejs/exit-waterfall).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
