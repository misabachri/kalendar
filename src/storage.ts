import { STORAGE_KEY, BACKUP_STORAGE_KEY, DEFAULT_DOCTORS } from './constants';
import type { Doctor, PreferenceValue, PreviousMonthLastTwo } from './types';
import { dayBeforeMonthStart, sameDate } from './utils/date';

export interface PersistedState {
  year: number;
  month: number;
  doctors: Doctor[];
  maxShiftsByDoctor: Record<number, number>;
  targetShiftsByDoctor: Record<number, number>;
  preferences: Record<number, Record<number, PreferenceValue>>;
  locks: Record<number, number | null>;
  previousMonthLastTwo: PreviousMonthLastTwo;
  seed: string;
}

function coerceState(rawParsed: unknown, fallback: PersistedState): PersistedState {
  const parsed = rawParsed as PersistedState & {
    customMaxByDoctor?: Record<number, number>;
    lastMonthService?: Record<number, string | null>;
  };

  let previousMonthLastTwo = parsed.previousMonthLastTwo;
  if (!previousMonthLastTwo && parsed.lastMonthService) {
    let lastDoctorId: number | null = null;
    const prevLastDay = dayBeforeMonthStart(parsed.year ?? fallback.year, parsed.month ?? fallback.month);
    for (const [doctorId, dateRaw] of Object.entries(parsed.lastMonthService)) {
      if (!dateRaw) {
        continue;
      }
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime()) && sameDate(d, prevLastDay)) {
        lastDoctorId = Number(doctorId);
        break;
      }
    }
    previousMonthLastTwo = { penultimateDoctorId: null, lastDoctorId };
  }

  const parsedDoctors = Array.isArray(parsed.doctors) ? parsed.doctors : [];
  let doctors = fallback.doctors;
  if (parsedDoctors.length === 10) {
    doctors = parsedDoctors.map((doctor) =>
      (doctor as { role: string }).role === 'custom' ? { ...doctor, role: 'regular' } : doctor,
    );
  } else if (parsedDoctors.length === 9) {
    doctors = [...parsedDoctors, fallback.doctors[9]];
  }

  doctors = doctors.map((doctor) => {
    if (doctor.id === 2 && doctor.role === 'zastupce' && doctor.name.trim() === 'Zástupce') {
      return { ...doctor, name: 'Fero (zástupce)' };
    }
    if (doctor.id === 3) {
      return { ...doctor, name: 'Tom' };
    }
    if (doctor.id === 4) {
      return { ...doctor, name: 'Lukáš' };
    }
    if (doctor.id === 5) {
      return { ...doctor, name: 'Zdeněk' };
    }
    if (doctor.id === 6) {
      return { ...doctor, name: 'Bachri' };
    }
    if (doctor.id === 7) {
      return { ...doctor, name: 'Kuba' };
    }
    if (doctor.id === 8) {
      return { ...doctor, name: 'Adam' };
    }
    if (doctor.id === 9) {
      return { ...doctor, name: 'Pepa' };
    }
    if (doctor.id === 10) {
      return { ...doctor, name: 'Radim' };
    }
    return doctor;
  });

  const maxShiftsByDoctor = {
    ...defaultMaxByDoctor(doctors),
    ...(parsed.customMaxByDoctor ?? {}),
    ...(parsed.maxShiftsByDoctor ?? {}),
  };

  return {
    ...fallback,
    ...parsed,
    doctors,
    maxShiftsByDoctor,
    targetShiftsByDoctor: {
      ...defaultTargets(doctors, maxShiftsByDoctor),
      ...(parsed.targetShiftsByDoctor ?? {}),
    },
    previousMonthLastTwo: previousMonthLastTwo ?? fallback.previousMonthLastTwo,
  };
}

function defaultMaxForDoctor(doctor: Doctor): number {
  if (doctor.role === 'primar') {
    return 1;
  }
  if (doctor.role === 'zastupce') {
    return 2;
  }
  return 5;
}

function defaultMaxByDoctor(doctors: Doctor[]): Record<number, number> {
  return Object.fromEntries(doctors.map((doctor) => [doctor.id, defaultMaxForDoctor(doctor)]));
}

function defaultTargetForDoctor(doctor: Doctor, maxShiftsByDoctor: Record<number, number>): number {
  if (doctor.role === 'primar') {
    return 1;
  }
  if (doctor.role === 'zastupce') {
    return 2;
  }
  return Math.max(0, Math.floor(maxShiftsByDoctor[doctor.id] ?? 5));
}

function defaultTargets(doctors: Doctor[], maxShiftsByDoctor: Record<number, number>): Record<number, number> {
  return Object.fromEntries(doctors.map((doctor) => [doctor.id, defaultTargetForDoctor(doctor, maxShiftsByDoctor)]));
}

export function makeDefaultState(): PersistedState {
  const now = new Date();
  const doctors = DEFAULT_DOCTORS;
  const maxShiftsByDoctor = defaultMaxByDoctor(doctors);
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    doctors,
    maxShiftsByDoctor,
    targetShiftsByDoctor: defaultTargets(doctors, maxShiftsByDoctor),
    preferences: {},
    locks: {},
    previousMonthLastTwo: { penultimateDoctorId: null, lastDoctorId: null },
    seed: '',
  };
}

export function loadState(): PersistedState {
  const fallback = makeDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    return coerceState(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function parseStateFromJson(raw: string): PersistedState | null {
  try {
    const fallback = makeDefaultState();
    return coerceState(JSON.parse(raw), fallback);
  } catch {
    return null;
  }
}

export function saveBackupState(state: PersistedState): void {
  localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(state));
}

export function loadBackupState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return coerceState(JSON.parse(raw), makeDefaultState());
  } catch {
    return null;
  }
}
