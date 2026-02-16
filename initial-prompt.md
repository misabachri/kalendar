You are Codex. Build a web app that generates a monthly on-call schedule
(“měsíční přehled sloužících lékařů”) for 9 doctors.

TECH STACK
- React + TypeScript + Vite
- Tailwind CSS
- LocalStorage persistence
- Printable A4 calendar output (print CSS)
- Optional CSV export
- Czech UI

DEFAULT DOCTOR SET (pre-filled on first load)
Doctor order is fixed and important (#1–#9):

1 - "Primář" (role: primář)
2 - "Zástupce" (role: zástupce)
3 - "Lékař 3" (regular)
4 - "Lékař 4" (regular)
5 - "Lékař 5" (regular)
6 - "Lékař 6" (regular)
7 - "Lékař 7" (regular)
8 - "Lékař 8" (regular)
9 - "Lékař 9" (regular)

RULES

HARD CONSTRAINTS
1) Exactly one doctor per day.
2) Unavailable dates must be respected.
3) Post-call rest day:
   - If a doctor serves on D, they cannot serve on D+1.
4) Cross-month rest:
   - App must allow entering for each doctor:
     “Poslední služba v minulém měsíci” (date or none).
   - If last service was the final day before month start,
     doctor cannot serve on day 1.
5) Primář and Zástupce:
   - Cannot serve Friday, Saturday, Sunday.
   - Max 3 shifts per month (never relax).
6) Locks:
   - Locked days are hard constraints.
   - Detect contradictions.

REGULAR DOCTORS
- Target: max 5 shifts.
- If full schedule impossible:
  - Relax max 5 strictly in this order:
    9 → 8 → 7 → 6 → 5 → 4 → 3 → 2 → 1
  - Primář and Zástupce caps (3) must NEVER be relaxed.
  - Relax minimally and report exceedances.

SOFT CONSTRAINT PRIORITY
1) Maximize satisfying preferences (avoidDates, preferDates).
2) Avoid every-other-day assignments (D and D+2).
3) Balance total shifts among regular doctors.
4) Balance weekend burden (Fri/Sat/Sun).
5) Prefer Fri+Sun pairing for same doctor, Saturday different doctor.

ALGORITHM
- Backtracking with forward checking and scoring.
- Most constrained day first heuristic.
- Deterministic by default.
- Optional seed for alternative generation.
- If impossible even after cap relaxation:
  - Show detailed conflict report.

UI FLOW (Czech)
1) Měsíc + rok
2) Lékaři (editable names but fixed order #1–#9 visible)
3) Minulý měsíc – zadání poslední služby
4) Požadavky a dostupnost (calendar toggles: Nemůže / Nechce / Chce)
5) Zamykání služeb
6) Generování

OUTPUT
- Printable calendar:
  - Title: "Služby – {měsíc} {rok}"
  - Clean month grid
  - Each day shows doctor nickname
  - Hide controls in print
  - Footer: timestamp + seed (optional)

- Stats section:
  - Total shifts
  - Weekend shifts
  - Fri+Sun pairings
  - Any cap relaxations clearly marked

DELIVERABLES
- Full working codebase
- README explaining constraint logic and fallback mechanism
