import type {
  Doctor,
  PreferenceValue,
  RelaxationInfo,
  ScheduleInput,
  ScheduleResult,
  ScheduleStats,
} from './types';
import { AMBULANCE_WEEKDAYS_BY_DOCTOR_ID } from './constants';
import { daysInMonth, isFriday, isWeekendServiceDay, weekday } from './utils/date';

interface SolveState {
  assignments: Record<number, number>;
  counts: Record<number, number>;
  weekendBlocksByDoctor: Record<number, Record<string, number>>;
  weekendBlockTotals: Record<number, number>;
}

type WantedDoctorsByDay = Record<number, number[]>;

function isLeadershipDoctor(doctor: Doctor): boolean {
  return doctor.role === 'primar' || doctor.role === 'zastupce';
}

function isCertifiedDoctor(doctor: Doctor): boolean {
  return doctor.order <= 5;
}

function isTuesdayOrThursday(year: number, month: number, day: number): boolean {
  const wd = weekday(year, month, day);
  return wd === 2 || wd === 4;
}

function makeRng(seed?: string): () => number {
  if (!seed) {
    return () => Math.random();
  }
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function initialCaps(doctors: Doctor[], maxShiftsByDoctor: Record<number, number>): Record<number, number> {
  const caps: Record<number, number> = {};
  for (const doctor of doctors) {
    if (doctor.role === 'primar') {
      caps[doctor.id] = 1;
      continue;
    }
    if (doctor.role === 'zastupce') {
      caps[doctor.id] = 2;
      continue;
    }
    const maxRaw = maxShiftsByDoctor[doctor.id];
    const max = Number.isFinite(maxRaw) ? Math.floor(maxRaw) : 5;
    caps[doctor.id] = Math.max(0, max);
  }
  return caps;
}

function sanitizeTargets(input: ScheduleInput): Record<number, number> {
  const result: Record<number, number> = {};
  for (const doctor of input.doctors) {
    const raw = input.targetShiftsByDoctor[doctor.id];
    const target = Number.isFinite(raw) ? Math.floor(raw) : 0;
    result[doctor.id] = Math.max(0, target);
  }
  return result;
}

function hasCrossMonthRestBlock(doctorId: number, lastDoctorId: number | null): boolean {
  return lastDoctorId === doctorId;
}

function preferenceAt(preferences: Record<number, Record<number, PreferenceValue>>, doctorId: number, day: number): PreferenceValue {
  return preferences[doctorId]?.[day] ?? 0;
}

function computeWantedDoctorsByDay(input: ScheduleInput): WantedDoctorsByDay {
  const days = daysInMonth(input.year, input.month);
  const byDay: WantedDoctorsByDay = {};

  for (let day = 1; day <= days; day += 1) {
    const wantDoctors = input.doctors
      .filter((doctor) => preferenceAt(input.preferences, doctor.id, day) === 3)
      .sort((a, b) => a.order - b.order);
    byDay[day] = wantDoctors.map((doctor) => doctor.id);
  }

  return byDay;
}

function forcedWantDoctorForDay(
  day: number,
  wantedDoctorsByDay: WantedDoctorsByDay,
  counts: Record<number, number>,
  targets: Record<number, number>,
): number | null {
  const wantedIds = wantedDoctorsByDay[day] ?? [];
  for (const doctorId of wantedIds) {
    if ((counts[doctorId] ?? 0) < (targets[doctorId] ?? 0)) {
      return doctorId;
    }
  }
  return null;
}

function lockedDoctor(locks: Record<number, number | null>, day: number): number | null {
  return locks[day] ?? null;
}

function isHardAllowed(
  day: number,
  doctor: Doctor,
  state: SolveState,
  caps: Record<number, number>,
  strictTargets: boolean,
  targets: Record<number, number>,
  wantedDoctorsByDay: WantedDoctorsByDay,
  input: ScheduleInput,
): boolean {
  const forcedWantDoctorId = forcedWantDoctorForDay(day, wantedDoctorsByDay, state.counts, targets);
  if (forcedWantDoctorId !== null && forcedWantDoctorId !== doctor.id) {
    return false;
  }

  const forced = lockedDoctor(input.locks, day);
  if (forced !== null && forced !== doctor.id) {
    return false;
  }

  const pref = preferenceAt(input.preferences, doctor.id, day);
  if (pref === 1) {
    return false;
  }

  if (day === 1 && hasCrossMonthRestBlock(doctor.id, input.previousMonthLastTwo.lastDoctorId)) {
    return false;
  }

  if (isLeadershipDoctor(doctor) && isWeekendServiceDay(input.year, input.month, day)) {
    return false;
  }

  if (isTuesdayOrThursday(input.year, input.month, day) && !isCertifiedDoctor(doctor)) {
    return false;
  }

  const nextCount = (state.counts[doctor.id] ?? 0) + 1;
  if (nextCount > caps[doctor.id]) {
    return false;
  }
  if (strictTargets && nextCount > targets[doctor.id]) {
    return false;
  }

  if (state.assignments[day - 1] === doctor.id) {
    return false;
  }

  if (state.assignments[day + 1] === doctor.id) {
    return false;
  }

  const weekendKey = weekendBlockKey(input.year, input.month, day);
  if (weekendKey) {
    const hasThisBlock = (state.weekendBlocksByDoctor[doctor.id]?.[weekendKey] ?? 0) > 0;
    if (!hasThisBlock && (state.weekendBlockTotals[doctor.id] ?? 0) >= 2) {
      return false;
    }
  }

  return true;
}

function isBaseHardAllowedForDiscussion(
  day: number,
  doctor: Doctor,
  state: SolveState,
  input: ScheduleInput,
): boolean {
  const forced = lockedDoctor(input.locks, day);
  if (forced !== null && forced !== doctor.id) {
    return false;
  }

  const pref = preferenceAt(input.preferences, doctor.id, day);
  if (pref === 1) {
    return false;
  }

  if (day === 1 && hasCrossMonthRestBlock(doctor.id, input.previousMonthLastTwo.lastDoctorId)) {
    return false;
  }

  if (isLeadershipDoctor(doctor) && isWeekendServiceDay(input.year, input.month, day)) {
    return false;
  }

  if (isTuesdayOrThursday(input.year, input.month, day) && !isCertifiedDoctor(doctor)) {
    return false;
  }

  if (state.assignments[day - 1] === doctor.id) {
    return false;
  }

  if (state.assignments[day + 1] === doctor.id) {
    return false;
  }

  const weekendKey = weekendBlockKey(input.year, input.month, day);
  if (weekendKey) {
    const hasThisBlock = (state.weekendBlocksByDoctor[doctor.id]?.[weekendKey] ?? 0) > 0;
    if (!hasThisBlock && (state.weekendBlockTotals[doctor.id] ?? 0) >= 2) {
      return false;
    }
  }

  return true;
}

function scoreCandidate(
  day: number,
  doctor: Doctor,
  state: SolveState,
  input: ScheduleInput,
  targets: Record<number, number>,
): number {
  let score = 0;
  const pref = preferenceAt(input.preferences, doctor.id, day);

  if (pref === 3) {
    score -= 250;
  }
  if (pref === 2) {
    score += 50;
  }

  if (state.assignments[day - 2] === doctor.id) {
    score += 10;
  }
  if (state.assignments[day + 2] === doctor.id) {
    score += 10;
  }

  const nextCount = (state.counts[doctor.id] ?? 0) + 1;
  score += Math.abs(nextCount - targets[doctor.id]) * 12;

  // Soft preference: avoid assigning a doctor the day before their ambulance day.
  const clinicWeekdays = AMBULANCE_WEEKDAYS_BY_DOCTOR_ID[doctor.id] ?? [];
  const nextWeekday = (weekday(input.year, input.month, day) + 1) % 7;
  if (clinicWeekdays.includes(nextWeekday)) {
    score += 18;
  }

  return score;
}

function weekendBlockKey(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  const weekdayJs = d.getDay();
  if (weekdayJs !== 5 && weekdayJs !== 6 && weekdayJs !== 0) {
    return null;
  }
  const shiftToFriday = weekdayJs === 5 ? 0 : weekdayJs === 6 ? -1 : -2;
  d.setDate(d.getDate() + shiftToFriday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validateLocks(
  input: ScheduleInput,
  caps: Record<number, number>,
  targets: Record<number, number>,
  wantedDoctorsByDay: WantedDoctorsByDay,
): string[] {
  const issues: string[] = [];
  const days = daysInMonth(input.year, input.month);
  const lockedCountsBeforeDay: Record<number, number> = {};

  for (let day = 1; day <= days; day += 1) {
    const docId = lockedDoctor(input.locks, day);
    if (docId === null) {
      continue;
    }
    const doctor = input.doctors.find((d) => d.id === docId);
    if (!doctor) {
      issues.push(`Den ${day}: zamčený lékař neexistuje.`);
      continue;
    }

    const forcedWantDoctorId = forcedWantDoctorForDay(day, wantedDoctorsByDay, lockedCountsBeforeDay, targets);
    if (forcedWantDoctorId !== null && forcedWantDoctorId !== docId) {
      const forcedWantDoctor = input.doctors.find((d) => d.id === forcedWantDoctorId);
      issues.push(
        `Den ${day}: zamčení (${doctor.name}) je v konfliktu s prioritním "Chce" (${forcedWantDoctor?.name ?? 'neznámý lékař'}).`,
      );
    }

    if (preferenceAt(input.preferences, docId, day) === 1) {
      issues.push(`Den ${day}: zamčení je v konfliktu s "Nemůže" (${doctor.name}).`);
    }
    if (isLeadershipDoctor(doctor) && isWeekendServiceDay(input.year, input.month, day)) {
      issues.push(`Den ${day}: ${doctor.name} nemůže sloužit Pá/So/Ne.`);
    }
    if (isTuesdayOrThursday(input.year, input.month, day) && !isCertifiedDoctor(doctor)) {
      issues.push(`Den ${day}: ${doctor.name} není atestovaný, úterky a čtvrtky musí krýt atestovaní (#1–#5).`);
    }
    if (day === 1 && hasCrossMonthRestBlock(docId, input.previousMonthLastTwo.lastDoctorId)) {
      issues.push(`Den 1: ${doctor.name} má odpočinek po službě z minulého měsíce.`);
    }
    if (day > 1 && lockedDoctor(input.locks, day - 1) === docId) {
      issues.push(`Dny ${day - 1} a ${day}: ${doctor.name} nemůže sloužit dva dny po sobě.`);
    }
    lockedCountsBeforeDay[docId] = (lockedCountsBeforeDay[docId] ?? 0) + 1;
  }

  const lockCounts: Record<number, number> = {};
  const lockedWeekendBlocksByDoctor: Record<number, Record<string, true>> = {};
  for (let day = 1; day <= days; day += 1) {
    const docId = lockedDoctor(input.locks, day);
    if (docId !== null) {
      lockCounts[docId] = (lockCounts[docId] ?? 0) + 1;
      const key = weekendBlockKey(input.year, input.month, day);
      if (key) {
        if (!lockedWeekendBlocksByDoctor[docId]) {
          lockedWeekendBlocksByDoctor[docId] = {};
        }
        lockedWeekendBlocksByDoctor[docId][key] = true;
      }
    }
  }
  for (const doctor of input.doctors) {
    const count = lockCounts[doctor.id] ?? 0;
    if (count > caps[doctor.id]) {
      issues.push(`${doctor.name}: počet zamčených služeb překračuje limit ${caps[doctor.id]}.`);
    }
    const weekendBlockCount = Object.keys(lockedWeekendBlocksByDoctor[doctor.id] ?? {}).length;
    if (weekendBlockCount > 2) {
      issues.push(`${doctor.name}: zamčené služby překračují limit 2 víkendových bloků (Pá–Ne).`);
    }
  }

  return issues;
}

function strictTargetFeasible(
  doctors: Doctor[],
  state: SolveState,
  targets: Record<number, number>,
  totalDays: number,
): boolean {
  const assigned = Object.keys(state.assignments).length;
  const remainingDays = totalDays - assigned;

  let needTotal = 0;
  for (const doctor of doctors) {
    const current = state.counts[doctor.id] ?? 0;
    const target = targets[doctor.id] ?? 0;
    if (current > target) {
      return false;
    }
    needTotal += target - current;
  }

  return needTotal <= remainingDays;
}

function createInitialState(doctors: Doctor[]): SolveState {
  return {
    assignments: {},
    counts: Object.fromEntries(doctors.map((d) => [d.id, 0])),
    weekendBlocksByDoctor: Object.fromEntries(doctors.map((d) => [d.id, {}])),
    weekendBlockTotals: Object.fromEntries(doctors.map((d) => [d.id, 0])),
  };
}

function applyAssignment(state: SolveState, year: number, month: number, day: number, doctorId: number): void {
  const weekendKey = weekendBlockKey(year, month, day);
  state.assignments[day] = doctorId;
  state.counts[doctorId] = (state.counts[doctorId] ?? 0) + 1;

  if (!weekendKey) {
    return;
  }
  const byDoctor = state.weekendBlocksByDoctor[doctorId];
  const prevCount = byDoctor[weekendKey] ?? 0;
  byDoctor[weekendKey] = prevCount + 1;
  if (prevCount === 0) {
    state.weekendBlockTotals[doctorId] = (state.weekendBlockTotals[doctorId] ?? 0) + 1;
  }
}

function solveWithCaps(
  input: ScheduleInput,
  caps: Record<number, number>,
  targets: Record<number, number>,
  wantedDoctorsByDay: WantedDoctorsByDay,
  rng: () => number,
  strictTargets: boolean,
): { ok: true; assignments: Record<number, number> } | { ok: false; reason: string } {
  const days = daysInMonth(input.year, input.month);

  if (strictTargets) {
    const totalTarget = input.doctors.reduce((sum, d) => sum + (targets[d.id] ?? 0), 0);
    if (totalTarget !== days) {
      return { ok: false, reason: 'Součet požadovaných služeb není roven počtu dní v měsíci.' };
    }
  }

  const state: SolveState = {
    ...createInitialState(input.doctors),
  };

  const backtrack = (): boolean => {
    if (Object.keys(state.assignments).length === days) {
      if (!strictTargets) {
        return true;
      }
      return input.doctors.every((doctor) => (state.counts[doctor.id] ?? 0) === (targets[doctor.id] ?? 0));
    }

    let targetDay = -1;
    let targetCandidates: Doctor[] = [];

    for (let day = 1; day <= days; day += 1) {
      if (state.assignments[day]) {
        continue;
      }
      const candidates = input.doctors.filter((doctor) =>
        isHardAllowed(day, doctor, state, caps, strictTargets, targets, wantedDoctorsByDay, input),
      );
      if (candidates.length === 0) {
        return false;
      }
      if (targetDay === -1 || candidates.length < targetCandidates.length) {
        targetDay = day;
        targetCandidates = candidates;
      }
    }

    targetCandidates.sort((a, b) => {
      const aPref = preferenceAt(input.preferences, a.id, targetDay);
      const bPref = preferenceAt(input.preferences, b.id, targetDay);
      if (aPref === 3 && bPref === 3) {
        return a.order - b.order;
      }
      if (aPref === 3 || bPref === 3) {
        return bPref - aPref;
      }

      const as = scoreCandidate(targetDay, a, state, input, targets) + rng() * 0.001;
      const bs = scoreCandidate(targetDay, b, state, input, targets) + rng() * 0.001;
      if (as !== bs) {
        return as - bs;
      }
      return a.order - b.order;
    });

    for (const doctor of targetCandidates) {
      const weekendKey = weekendBlockKey(input.year, input.month, targetDay);
      applyAssignment(state, input.year, input.month, targetDay, doctor.id);

      let forwardOk = true;
      for (let day = 1; day <= days; day += 1) {
        if (state.assignments[day]) {
          continue;
        }
        const exists = input.doctors.some((d) =>
          isHardAllowed(day, d, state, caps, strictTargets, targets, wantedDoctorsByDay, input),
        );
        if (!exists) {
          forwardOk = false;
          break;
        }
      }

      if (forwardOk && strictTargets && !strictTargetFeasible(input.doctors, state, targets, days)) {
        forwardOk = false;
      }

      if (forwardOk && backtrack()) {
        return true;
      }

      delete state.assignments[targetDay];
      state.counts[doctor.id] -= 1;
      if (weekendKey) {
        const byDoctor = state.weekendBlocksByDoctor[doctor.id];
        const prevCount = byDoctor[weekendKey] ?? 0;
        if (prevCount <= 1) {
          delete byDoctor[weekendKey];
          state.weekendBlockTotals[doctor.id] -= 1;
        } else {
          byDoctor[weekendKey] = prevCount - 1;
        }
      }
    }

    return false;
  };

  const solved = backtrack();
  if (!solved) {
    return { ok: false, reason: 'Backtracking nenašel řešení při aktuálních limitech.' };
  }
  return { ok: true, assignments: state.assignments };
}

function buildPartialProposal(
  input: ScheduleInput,
  caps: Record<number, number>,
  targets: Record<number, number>,
  wantedDoctorsByDay: WantedDoctorsByDay,
  rng: () => number,
): {
  assignments: Record<number, number | null>;
  unassignedDays: Array<{ day: number; candidateDoctorIds: number[] }>;
} {
  const days = daysInMonth(input.year, input.month);
  const state = createInitialState(input.doctors);
  const assignments: Record<number, number | null> = {};
  const unassignedDays: Array<{ day: number; candidateDoctorIds: number[] }> = [];

  for (let day = 1; day <= days; day += 1) {
    const candidates = input.doctors.filter((doctor) =>
      isHardAllowed(day, doctor, state, caps, false, targets, wantedDoctorsByDay, input),
    );

    if (candidates.length === 0) {
      const discussionCandidates = input.doctors
        .filter((doctor) => isBaseHardAllowedForDiscussion(day, doctor, state, input))
        .sort((a, b) => a.order - b.order)
        .map((doctor) => doctor.id);
      if (discussionCandidates.length > 0) {
        // Prefill a discussion-safe candidate so the user always gets a usable draft schedule.
        const selectedDoctorId = discussionCandidates[0];
        assignments[day] = selectedDoctorId;
        applyAssignment(state, input.year, input.month, day, selectedDoctorId);
        unassignedDays.push({ day, candidateDoctorIds: discussionCandidates });
      } else {
        assignments[day] = null;
        unassignedDays.push({ day, candidateDoctorIds: discussionCandidates });
      }
      continue;
    }

    candidates.sort((a, b) => {
      const as = scoreCandidate(day, a, state, input, targets) + rng() * 0.001;
      const bs = scoreCandidate(day, b, state, input, targets) + rng() * 0.001;
      if (as !== bs) {
        return as - bs;
      }
      return a.order - b.order;
    });

    const chosen = candidates[0];
    assignments[day] = chosen.id;
    applyAssignment(state, input.year, input.month, day, chosen.id);
  }

  return { assignments, unassignedDays };
}

function buildStats(
  assignments: Record<number, number>,
  doctors: Doctor[],
  year: number,
  month: number,
): ScheduleStats {
  const totalByDoctor: Record<number, number> = {};
  const weekendByDoctor: Record<number, number> = {};
  for (const doctor of doctors) {
    totalByDoctor[doctor.id] = 0;
    weekendByDoctor[doctor.id] = 0;
  }

  for (const [dayStr, docId] of Object.entries(assignments)) {
    const day = Number(dayStr);
    totalByDoctor[docId] += 1;
    if (isWeekendServiceDay(year, month, day)) {
      weekendByDoctor[docId] += 1;
    }
  }

  let friSunPairings = 0;
  const days = daysInMonth(year, month);
  for (let day = 1; day <= days - 2; day += 1) {
    if (!isFriday(year, month, day)) {
      continue;
    }
    const fri = assignments[day];
    const sat = assignments[day + 1];
    const sun = assignments[day + 2];
    if (fri && sun && fri === sun && sat && sat !== fri) {
      friSunPairings += 1;
    }
  }

  return {
    totalByDoctor,
    weekendByDoctor,
    friSunPairings,
  };
}

function emptyRelaxationSummary(): RelaxationInfo[] {
  return [];
}

export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const caps = initialCaps(input.doctors, input.maxShiftsByDoctor);
  const targets = sanitizeTargets(input);
  const wantedDoctorsByDay = computeWantedDoctorsByDay(input);
  const rng = makeRng(input.seed);

  const lockIssues = validateLocks(input, caps, targets, wantedDoctorsByDay);
  if (lockIssues.length > 0) {
    return {
      ok: false,
      conflicts: lockIssues,
      relaxationsAttempted: [],
    };
  }

  const strictAttempt = solveWithCaps(input, caps, targets, wantedDoctorsByDay, rng, true);
  if (strictAttempt.ok) {
    return {
      ok: true,
      assignments: strictAttempt.assignments,
      stats: buildStats(strictAttempt.assignments, input.doctors, input.year, input.month),
      relaxations: emptyRelaxationSummary(),
      seedUsed: input.seed || undefined,
    };
  }

  const fallbackAttempt = solveWithCaps(input, caps, targets, wantedDoctorsByDay, rng, false);
  if (fallbackAttempt.ok) {
    return {
      ok: true,
      assignments: fallbackAttempt.assignments,
      stats: buildStats(fallbackAttempt.assignments, input.doctors, input.year, input.month),
      relaxations: emptyRelaxationSummary(),
      seedUsed: input.seed || undefined,
    };
  }

  const partialProposal = buildPartialProposal(input, caps, targets, wantedDoctorsByDay, rng);
  const hasUnassignedDay = Object.values(partialProposal.assignments).some((doctorId) => doctorId === null);
  if (!hasUnassignedDay) {
    const assignments = Object.fromEntries(
      Object.entries(partialProposal.assignments).map(([day, doctorId]) => [Number(day), doctorId as number]),
    ) as Record<number, number>;
    return {
      ok: true,
      assignments,
      stats: buildStats(assignments, input.doctors, input.year, input.month),
      relaxations: emptyRelaxationSummary(),
      seedUsed: input.seed || undefined,
    };
  }

  return {
    ok: false,
    conflicts: [strictAttempt.reason, fallbackAttempt.reason],
    relaxationsAttempted: emptyRelaxationSummary(),
    partialProposal,
  };
}
