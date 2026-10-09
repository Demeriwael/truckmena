# Wayline HOS rules

Wayline plans a solo property-carrying driver's trip using the 70-hour / 8-day cycle. The [FMCSA HOS summary](https://www.fmcsa.dot.gov/regulations/hours-service/summary-hours-service-regulations) describes the underlying limits. The tables and decisions below describe this project's implementation and assumptions.

## Engine and clocks

The pure [HOS engine](../backend/trips/services/hos_engine.py) accepts two connected route legs, their provider mileage, and initial cycle usage. It returns immutable, positive, contiguous duty events. It has no Django, network, filesystem, timezone, or database dependencies.

Four statuses are used: `OFF`, `SLEEPER`, `DRIVING`, and `ON_DUTY`. Driving and non-driving work both consume cycle time. Driving starts the duty window if it is the first on-duty activity. Midnight does not reset any HOS clock.

| Constraint        | Implementation                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driving allowance | At most 660 driving minutes between qualifying daily rests.                                                                                       |
| Duty window       | Driving ends by 840 elapsed minutes after the first on-duty activity. Short off-duty pauses do not extend the window.                             |
| Driving break     | Before exceeding 480 accumulated driving minutes, require 30 consecutive non-driving minutes. Consecutive mixed non-driving statuses can qualify. |
| Cycle             | Driving and work consume the 4,200-minute cycle. Further driving is prohibited when it is exhausted.                                              |
| Daily rest        | 600 continuous minutes in OFF/SLEEPER restore daily driving and window allowances.                                                                |
| Restart           | 2,040 continuous minutes in OFF/SLEEPER restore cycle and daily allowances.                                                                       |

The engine checks a driving interval against the smallest remaining driving, window, break, and cycle allowance. A driving interval that exceeds an allowance raises `HOSViolation`.

## Planning assumptions

| Input or assumption | Behavior                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Prior duty          | Trip start assumes fresh daily driving and duty-window allowances. Initial cycle usage is the only prior-duty input.                      |
| Rolling history     | No historical cycle hours drop off because prior daily records are not supplied.                                                          |
| Speed               | Provider distance determines mileage; the public API schedules driving at 55 mph. Provider travel duration is reference information only. |
| Work                | Pickup and delivery each take 60 on-duty minutes.                                                                                         |
| Fuel                | A 30-minute ON_DUTY stop is inserted before driving beyond a 1,000-mile gap.                                                              |
| Calendar            | Log days use one fixed departure offset. Crossing midnight or a daylight-saving transition does not change that offset.                   |

Speed and work durations can vary in domain-level fixtures. They are not adjustable fields in the public trip-planning request. Longer pickup fixtures exercise the 14-hour window without inventing prior duty.

## Boundary decisions

- Arrival work happens before a pause required for the next drive. Pickup, delivery, and fueling may finish even if non-driving work takes cycle usage above 70 hours. No further driving follows until the cycle is reset; available cycle time is clamped at zero.
- At exactly eight driving hours, a one-hour pickup satisfies the driving break. A fuel stop also satisfies that break.
- A final arrival adds no unnecessary break, daily rest, restart, or fuel stop. A fuel gap of exactly 1,000 miles is allowed at the final destination; fuel is inserted at that position before any additional driving.
- When obligations coincide, the scheduler resolves cycle restart, daily rest, fuel, then driving break. Fuel and sleeper rest retain their distinct duty statuses even at the same route position.
- An initially exhausted cycle restarts before scheduled work or driving, including a zero-mile current-to-pickup leg. The pure engine accepts cycle values above 70 hours; the API restricts submitted values to 0–70.
- Daily rest restores daily allowances without restoring cycle availability. A completed 34-hour restart restores both. An unfinished restart does not reset the daily-log cycle recap.

## Rounding and mileage

All HOS clocks use integer minutes. Initial cycle usage is rounded upward to the next minute. Distances use exact rational arithmetic derived from supplied decimal mileage, preserving provider distance and exact 1,000-mile fuel frontiers.

Driving duration is `miles / average_mph * 60`, rounded upward at each fuel frontier or leg end. Each such frontier can add less than one minute while retaining mileage and never understating driving time. HOS limits can split a drive into further intervals without rounding the route's distance.

Daily sheets retain exact minute totals. Their printed decimal totals use a separate rounding method so the four rows add to 24.00 hours; see [log totals and mileage](LOG_SHEETS.md#totals-and-mileage).

## Scope and tests

Split-sleeper pairing, adverse-driving extensions, short-haul exceptions, and team driving are outside scope. Generated sheets are unsigned planning estimates rather than certified historical duty records. The fixed-offset calendar and limited prior history are explained in [Log Sheets](LOG_SHEETS.md).

[Engine tests](../backend/trips/tests/test_hos_engine.py) cover exact boundaries, simultaneous limits, zero-mile legs, fractional mileage, exhausted cycles, and independent schedule replay. [API tests](../backend/trips/tests/test_api.py) cover the public input range and integration with routing and log generation. Run them using the root commands in [Contributing](CONTRIBUTING.md#quality-checks).

[Back to README](../README.md)
