import { useEffect, useMemo, useRef, useState } from 'react';
import { AMBULANCE_WEEKDAYS_BY_DOCTOR_ID, CZECH_MONTHS, WEEKDAY_SHORT } from './constants';
import { generateSchedule } from './scheduler';
import {
  loadBackupState,
  loadSavedVersions,
  loadState,
  parseStateFromJson,
  saveVersion,
  saveBackupState,
  saveState,
  type SavedScheduleVersion,
  type PersistedState,
} from './storage';
import type { Doctor, PreferenceValue, ScheduleResult } from './types';
import { daysInMonth, weekday, weekdayMondayIndex } from './utils/date';

const PREF_LABELS: Record<PreferenceValue, string> = {
  0: 'Bez omezení',
  1: 'Nemůže',
  2: 'Nechce',
  3: 'Chce',
};

const PREF_SHORT: Record<PreferenceValue, string> = {
  0: 'OK',
  1: 'X',
  2: 'Ne',
  3: 'Chci',
};

const PREF_CLASS: Record<PreferenceValue, string> = {
  0: 'bg-white text-slate-700 border-slate-200',
  1: 'bg-rose-100 text-rose-800 border-rose-300',
  2: 'bg-amber-100 text-amber-800 border-amber-300',
  3: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};
const PREF_VALUES: PreferenceValue[] = [0, 1, 2, 3];

function roleLabel(role: Doctor['role']): string {
  if (role === 'primar') {
    return 'Primář';
  }
  if (role === 'zastupce') {
    return 'Zástupce';
  }
  return 'Běžný';
}

function isCertifiedDoctor(doctor: Doctor): boolean {
  return doctor.order <= 5;
}

function isFixedNamedDoctor(doctor: Doctor): boolean {
  return doctor.order >= 3;
}

function cyclePref(current: PreferenceValue): PreferenceValue {
  if (current === 3) {
    return 0;
  }
  return (current + 1) as PreferenceValue;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJson(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface CalendarCell {
  day: number | null;
  nextMonthDay: number | null;
}

function monthCells(year: number, month: number, dayCount: number): CalendarCell[] {
  const firstWeekday = weekdayMondayIndex(year, month, 1);
  const cells: CalendarCell[] = Array.from({ length: firstWeekday }, () => ({ day: null, nextMonthDay: null }));
  for (let day = 1; day <= dayCount; day += 1) {
    cells.push({ day, nextMonthDay: null });
  }
  let nextMonthDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, nextMonthDay });
    nextMonthDay += 1;
  }
  return cells;
}

interface MonthlyRequestPlan {
  year: number;
  month: number;
  preferences: Record<number, Record<number, PreferenceValue>>;
  locks: Record<number, number | null>;
  previousMonthLastTwo: PersistedState['previousMonthLastTwo'];
  seed: string;
  finalizedAt?: string;
}

export default function App() {
  const initial = useMemo(() => loadState(), []);

  const [doctors, setDoctors] = useState<Doctor[]>(initial.doctors);
  const [maxShiftsByDoctor, setMaxShiftsByDoctor] = useState(initial.maxShiftsByDoctor);
  const [targetShiftsByDoctor, setTargetShiftsByDoctor] = useState(initial.targetShiftsByDoctor);
  const [activePlanSlot, setActivePlanSlot] = useState<1 | 2>(initial.activePlanSlot === 2 ? 2 : 1);
  const [primaryPlan, setPrimaryPlan] = useState<MonthlyRequestPlan>({
    year: initial.year,
    month: initial.month,
    preferences: initial.preferences,
    locks: initial.locks,
    previousMonthLastTwo: initial.previousMonthLastTwo,
    seed: initial.seed,
    finalizedAt: initial.finalizedAt,
  });
  const [secondaryPlan, setSecondaryPlan] = useState<MonthlyRequestPlan>(
    initial.secondaryPlan ??
      (() => {
        const nextDate = new Date(initial.year, initial.month, 1);
        return {
          year: nextDate.getFullYear(),
          month: nextDate.getMonth() + 1,
          preferences: {},
          locks: {},
          previousMonthLastTwo: { penultimateDoctorId: null, lastDoctorId: null },
          seed: '',
          finalizedAt: undefined,
        };
      })(),
  );
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [activeDoctorId, setActiveDoctorId] = useState(initial.doctors[0]?.id ?? 1);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [debateSelectionByDay, setDebateSelectionByDay] = useState<Record<number, number>>({});
  const [showOnlyProblemDays, setShowOnlyProblemDays] = useState(false);
  const [resultSelectionByDay, setResultSelectionByDay] = useState<Record<number, number>>({});
  const [showDoctorsSection, setShowDoctorsSection] = useState(false);
  const [savedVersions, setSavedVersions] = useState<SavedScheduleVersion[]>(() => loadSavedVersions());
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [isExpertMode, setIsExpertMode] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  const activePlan = activePlanSlot === 1 ? primaryPlan : secondaryPlan;
  const year = activePlan.year;
  const month = activePlan.month;
  const preferences = activePlan.preferences;
  const locks = activePlan.locks;
  const previousMonthLastTwo = activePlan.previousMonthLastTwo;
  const seed = activePlan.seed;

  const setActivePlan = (updater: (prev: MonthlyRequestPlan) => MonthlyRequestPlan) => {
    if (activePlanSlot === 1) {
      setPrimaryPlan(updater);
      return;
    }
    setSecondaryPlan(updater);
  };

  const nextMonthOf = (yearValue: number, monthValue: number): { year: number; month: number } => {
    const d = new Date(yearValue, monthValue, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  };

  const setYear = (nextYear: number) => {
    setPrimaryPlan((prev) => ({
      ...prev,
      year: nextYear,
      preferences: {},
      locks: {},
      finalizedAt: undefined,
    }));
    setSecondaryPlan((prev) => {
      const next = nextMonthOf(nextYear, primaryPlan.month);
      return {
        ...prev,
        year: next.year,
        month: next.month,
        preferences: {},
        locks: {},
        finalizedAt: undefined,
      };
    });
    setResult(null);
  };
  const setMonth = (nextMonth: number) => {
    setPrimaryPlan((prev) => ({
      ...prev,
      month: nextMonth,
      preferences: {},
      locks: {},
      finalizedAt: undefined,
    }));
    setSecondaryPlan((prev) => {
      const next = nextMonthOf(primaryPlan.year, nextMonth);
      return {
        ...prev,
        year: next.year,
        month: next.month,
        preferences: {},
        locks: {},
        finalizedAt: undefined,
      };
    });
    setResult(null);
  };
  const setPreferences = (
    updater:
      | Record<number, Record<number, PreferenceValue>>
      | ((prev: Record<number, Record<number, PreferenceValue>>) => Record<number, Record<number, PreferenceValue>>),
  ) => {
    setActivePlan((prev) => ({
      ...prev,
      preferences: typeof updater === 'function' ? updater(prev.preferences) : updater,
      finalizedAt: undefined,
    }));
  };
  const setLocks = (
    updater: Record<number, number | null> | ((prev: Record<number, number | null>) => Record<number, number | null>),
  ) => {
    setActivePlan((prev) => ({
      ...prev,
      locks: typeof updater === 'function' ? updater(prev.locks) : updater,
      finalizedAt: undefined,
    }));
  };
  const setPreviousMonthLastTwo = (
    updater:
      | PersistedState['previousMonthLastTwo']
      | ((prev: PersistedState['previousMonthLastTwo']) => PersistedState['previousMonthLastTwo']),
  ) => {
    setActivePlan((prev) => ({
      ...prev,
      previousMonthLastTwo: typeof updater === 'function' ? updater(prev.previousMonthLastTwo) : updater,
      finalizedAt: undefined,
    }));
  };
  const setSeed = (nextSeed: string) => {
    setActivePlan((prev) => ({ ...prev, seed: nextSeed, finalizedAt: undefined }));
  };

  const dayCount = useMemo(() => daysInMonth(year, month), [year, month]);
  const cells = useMemo(() => monthCells(year, month, dayCount), [year, month, dayCount]);
  const activeDoctor = useMemo(() => doctors.find((d) => d.id === activeDoctorId) ?? doctors[0], [doctors, activeDoctorId]);

  useEffect(() => {
    if (!doctors.some((d) => d.id === activeDoctorId)) {
      setActiveDoctorId(doctors[0]?.id ?? 1);
    }
  }, [doctors, activeDoctorId]);

  useEffect(() => {
    saveState({
      year: primaryPlan.year,
      month: primaryPlan.month,
      doctors,
      maxShiftsByDoctor,
      targetShiftsByDoctor,
      preferences: primaryPlan.preferences,
      locks: primaryPlan.locks,
      previousMonthLastTwo: primaryPlan.previousMonthLastTwo,
      seed: primaryPlan.seed,
      finalizedAt: primaryPlan.finalizedAt,
      activePlanSlot,
      secondaryPlan: secondaryPlan,
    });
  }, [doctors, maxShiftsByDoctor, targetShiftsByDoctor, primaryPlan, secondaryPlan, activePlanSlot]);

  const updateDoctorName = (id: number, name: string) => {
    setDoctors((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
  };

  const updateMaxShifts = (doctorId: number, value: string) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setMaxShiftsByDoctor((prev) => ({ ...prev, [doctorId]: safe }));
    setTargetShiftsByDoctor((prev) => ({
      ...prev,
      [doctorId]: Math.min(Math.max(0, prev[doctorId] ?? safe), safe),
    }));
  };

  const updateTargetShifts = (doctorId: number, value: string) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    const doctor = doctors.find((d) => d.id === doctorId);
    const maxForDoctor =
      doctor?.role === 'primar'
        ? 1
        : doctor?.role === 'zastupce'
          ? 2
          : Math.max(0, Math.floor(maxShiftsByDoctor[doctorId] ?? 5));
    setTargetShiftsByDoctor((prev) => ({ ...prev, [doctorId]: Math.min(safe, maxForDoctor) }));
  };

  const adjustMaxShifts = (doctorId: number, delta: number) => {
    const doctor = doctors.find((d) => d.id === doctorId);
    const current = doctor?.role === 'primar' ? 1 : doctor?.role === 'zastupce' ? 2 : (maxShiftsByDoctor[doctorId] ?? 5);
    const next = Math.max(0, current + delta);
    updateMaxShifts(doctorId, String(next));
  };

  const adjustTargetShifts = (doctorId: number, delta: number) => {
    const current = targetShiftsByDoctor[doctorId] ?? 0;
    const next = Math.max(0, current + delta);
    updateTargetShifts(doctorId, String(next));
  };

  const setPref = (doctorId: number, day: number) => {
    setPreferences((prev) => {
      const current = (prev[doctorId]?.[day] ?? 0) as PreferenceValue;
      const next = cyclePref(current);
      return {
        ...prev,
        [doctorId]: {
          ...(prev[doctorId] ?? {}),
          [day]: next,
        },
      };
    });
  };

  const clearCurrentMonthRequirements = () => {
    setPreferences({});
    setLocks({});
    setResult(null);
    setGenerationNotice(null);
  };

  const runGenerationWithLocks = (nextLocks: Record<number, number | null>): ScheduleResult => {
    setActivePlan((prev) => ({ ...prev, finalizedAt: undefined }));
    const next = generateSchedule({
      year,
      month,
      doctors,
      maxShiftsByDoctor,
      targetShiftsByDoctor,
      preferences,
      locks: nextLocks,
      previousMonthLastTwo,
      seed: seed.trim() || undefined,
    });
    setResult(next);
    if (next.ok) {
      const mergedLocks: Record<number, number | null> = { ...nextLocks };
      let changed = false;
      for (let day = 1; day <= dayCount; day += 1) {
        const assignedDoctorId = next.assignments[day];
        if (!assignedDoctorId) {
          continue;
        }
        const pref = preferences[assignedDoctorId]?.[day] ?? 0;
        if (pref === 3 && mergedLocks[day] !== assignedDoctorId) {
          mergedLocks[day] = assignedDoctorId;
          changed = true;
        }
      }
      if (changed) {
        setLocks(mergedLocks);
      }
    }
    return next;
  };

  const runGeneration = () => {
    const hasGeneratedPlan = Boolean(result?.ok);
    const hasLockedDays = Object.values(locks).some((doctorId) => doctorId !== null && doctorId !== undefined);
    if (hasGeneratedPlan || hasLockedDays) {
      const confirmed = window.confirm(
        activePlan.finalizedAt
          ? 'Rozpis je označený jako finální. Opravdu ho chceš přegenerovat a přepsat?'
          : 'Už existuje vygenerovaný/částečně zamčený rozpis. Opravdu ho chceš přepsat?',
      );
      if (!confirmed) {
        return;
      }
    }

    const previousResult = result;
    const next = runGenerationWithLocks(locks);
    if (next.ok && previousResult?.ok) {
      const sameAssignments =
        JSON.stringify(next.assignments) === JSON.stringify(previousResult.assignments);
      setGenerationNotice(
        sameAssignments
          ? 'Přegenerování proběhlo, ale vyšel stejný rozpis.'
          : 'Rozpis byl úspěšně přegenerován.',
      );
    } else if (next.ok) {
      setGenerationNotice('Rozpis byl úspěšně vygenerován.');
    }
    if (!next.ok) {
      setGenerationNotice('Přegenerování selhalo - rozpis nelze při aktuálních požadavcích sestavit.');
      window.alert('Bohužel nelze vytvořit nový rozpis, protože při aktuálních požadavcích není matematicky realizovatelný.');
    }
    if (!next.ok && previousResult?.ok) {
      const keepPrevious = window.confirm(
        'Nový pokus o generování nevyšel. Chceš zachovat předchozí verzi a uložit ji do historie verzí?',
      );
      if (keepPrevious) {
        const version: SavedScheduleVersion = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          title: `${CZECH_MONTHS[month - 1]} ${year} - předchozí funkční verze`,
          state: currentState(),
          result: previousResult,
        };
        saveVersion(version);
        setSavedVersions(loadSavedVersions());
        setResult(previousResult);
        setBackupNotice('Předchozí funkční verze byla zachována a uložena do historie.');
      }
    }
  };

  const exportCsv = () => {
    if (!result || !result.ok) {
      return;
    }
    const lines = ['den,datum,lekar'];
    for (let day = 1; day <= dayCount; day += 1) {
      const doctor = doctors.find((d) => d.id === result.assignments[day]);
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      lines.push(`${day},${date},"${doctor?.name ?? ''}"`);
    }
    downloadCsv(lines.join('\n'), `sluzby-${year}-${String(month).padStart(2, '0')}.csv`);
  };

  const confirmLockForDay = (day: number, selectedDoctorId: number): boolean => {
    const selectedDoctor = doctors.find((d) => d.id === selectedDoctorId);
    const selectedDoctorName = selectedDoctor?.name ?? 'vybraného lékaře';
    const messages: string[] = [];
    const dayWeekday = weekday(year, month, day);
    const isTueOrThu = dayWeekday === 2 || dayWeekday === 4;

    const idealReplacementNames = (): string[] => {
      const pool = doctors
        .filter((doctor) => doctor.id !== selectedDoctorId)
        .sort((a, b) => a.order - b.order);

      const assignedDoctorAtDay = (targetDay: number): number | null => {
        if (targetDay < 1 || targetDay > dayCount) {
          return null;
        }
        const fromLock = locks[targetDay];
        if (fromLock !== null && fromLock !== undefined) {
          return fromLock;
        }
        if (result && result.ok) {
          return result.assignments[targetDay] ?? null;
        }
        return null;
      };
      const nearbyAssignedDoctorIds = new Set<number>();
      for (const nearDay of [day - 2, day - 1, day + 1, day + 2]) {
        const nearDoctorId = assignedDoctorAtDay(nearDay);
        if (nearDoctorId != null) {
          nearbyAssignedDoctorIds.add(nearDoctorId);
        }
      }
      const nearSafePool = pool.filter((doctor) => !nearbyAssignedDoctorIds.has(doctor.id));
      const effectivePool = nearSafePool.length > 0 ? nearSafePool : pool;

      const okCertified = effectivePool.filter(
        (doctor) => (preferences[doctor.id]?.[day] ?? 0) === 0 && (!isTueOrThu || isCertifiedDoctor(doctor)),
      );
      const okAny = effectivePool.filter((doctor) => (preferences[doctor.id]?.[day] ?? 0) === 0);
      const nonNegativeCertified = effectivePool.filter(
        (doctor) => (preferences[doctor.id]?.[day] ?? 0) !== 1 && (preferences[doctor.id]?.[day] ?? 0) !== 2 && (!isTueOrThu || isCertifiedDoctor(doctor)),
      );
      const nonNegativeAny = effectivePool.filter(
        (doctor) => (preferences[doctor.id]?.[day] ?? 0) !== 1 && (preferences[doctor.id]?.[day] ?? 0) !== 2,
      );

      const orderedUnique: Doctor[] = [];
      const seen = new Set<number>();
      for (const group of [okCertified, okAny, nonNegativeCertified, nonNegativeAny]) {
        for (const doctor of group) {
          if (seen.has(doctor.id)) {
            continue;
          }
          seen.add(doctor.id);
          orderedUnique.push(doctor);
        }
      }
      return orderedUnique.map((doctor) => doctor.name);
    };
    const idealNames = idealReplacementNames();

    if (selectedDoctor && (selectedDoctor.role === 'primar' || selectedDoctor.role === 'zastupce')) {
      const maxAllowed = maxShiftsByDoctor[selectedDoctorId] ?? (selectedDoctor.role === 'primar' ? 1 : 2);
      let projectedCount = 0;
      if (result && result.ok) {
        for (let d = 1; d <= dayCount; d += 1) {
          const currentDoctorId = d === day ? selectedDoctorId : result.assignments[d];
          if (currentDoctorId === selectedDoctorId) {
            projectedCount += 1;
          }
        }
      } else {
        projectedCount = Object.entries(locks).filter(([dayStr, doctorId]) => {
          if (Number(dayStr) === day) {
            return selectedDoctorId === doctorId;
          }
          return doctorId === selectedDoctorId;
        }).length;
        if (locks[day] !== selectedDoctorId) {
          projectedCount += 1;
        }
      }
      if (projectedCount > maxAllowed) {
        window.alert(`${selectedDoctorName} má maximum ${maxAllowed} služeb a tuto hodnotu nelze překročit.`);
        return false;
      }
    }

    const selectedPreference = preferences[selectedDoctorId]?.[day] ?? 0;
    if (selectedPreference === 1) {
      const suggestionText =
        idealNames.length > 0
          ? `\nIdeální náhrada: ${idealNames.join(', ')}.`
          : '';
      window.alert(`${selectedDoctorName} má na den ${day} nastaveno "Nemůže", proto ho nelze zamknout.${suggestionText}`);
      return false;
    } else if (selectedPreference === 2) {
      messages.push(`${selectedDoctorName} má na den ${day} nastaveno "Nechce".`);
    }

    const conflictingWantDoctors = doctors
      .filter((doctor) => doctor.id !== selectedDoctorId && (preferences[doctor.id]?.[day] ?? 0) === 3)
      .sort((a, b) => a.order - b.order);
    if (conflictingWantDoctors.length > 0) {
      messages.push(`Na den ${day} má "Chce" ještě ${conflictingWantDoctors.map((doctor) => doctor.name).join(', ')}.`);
    }

    const prevDayAssignedDoctorId =
      (day > 1 ? (locks[day - 1] ?? (result && result.ok ? result.assignments[day - 1] : null)) : null) ?? null;
    const nextDayAssignedDoctorId =
      (day < dayCount ? (locks[day + 1] ?? (result && result.ok ? result.assignments[day + 1] : null)) : null) ?? null;
    if (prevDayAssignedDoctorId === selectedDoctorId) {
      messages.push(`${selectedDoctorName} už slouží den předtím (den ${day - 1}).`);
    }
    if (nextDayAssignedDoctorId === selectedDoctorId) {
      messages.push(`${selectedDoctorName} už slouží den poté (den ${day + 1}).`);
    }

    if (isTueOrThu && selectedDoctor && !isCertifiedDoctor(selectedDoctor)) {
      messages.push(
        `${selectedDoctorName} není atestovaný a den ${day} je úterý/čtvrtek. Po zamknutí může být rozpis neřešitelný.`,
      );
    }

    if (idealNames.length > 0 && (selectedPreference === 2 || (isTueOrThu && selectedDoctor && !isCertifiedDoctor(selectedDoctor)))) {
      messages.push(`Ideální náhrada pro den ${day}: ${idealNames.join(', ')}.`);
    }

    if (messages.length === 0) {
      return true;
    }

    const confirmed = window.confirm(`${messages.join('\n')}\n\nChceš i přesto zamknout ${selectedDoctorName}?`);
    return confirmed;
  };

  const applyResultDayChangeAndRecalculate = (day: number) => {
    const selectedDoctorId = resultSelectionByDay[day];
    if (!selectedDoctorId) {
      return;
    }
    if (!confirmLockForDay(day, selectedDoctorId)) {
      if (result && result.ok) {
        setResultSelectionByDay((prev) => ({
          ...prev,
          [day]: result.assignments[day],
        }));
      }
      return;
    }
    const nextLocks = {
      ...locks,
      [day]: selectedDoctorId,
    };
    setLocks(nextLocks);
    runGenerationWithLocks(nextLocks);
  };

  const weekdayShortForDay = (day: number): string => WEEKDAY_SHORT[weekdayMondayIndex(year, month, day)];
  const isSoftWantLockedDay = (day: number): boolean => {
    const lockedDoctorId = locks[day];
    if (lockedDoctorId == null) {
      return false;
    }
    return (preferences[lockedDoctorId]?.[day] ?? 0) === 3;
  };

  const problematicDays = useMemo(() => {
    if (!result || !result.ok) {
      return [];
    }

    const items: Array<{ day: number; doctorName: string; reasons: string[] }> = [];
    for (let day = 1; day <= dayCount; day += 1) {
      const doctorId = result.assignments[day];
      const doctor = doctors.find((d) => d.id === doctorId);
      if (!doctor) {
        continue;
      }
      const reasons: string[] = [];
      const pref = preferences[doctorId]?.[day] ?? 0;
      if (pref === 2) {
        reasons.push('lékař má na dni "Nechce"');
      }
      const nextWeekday = (weekday(year, month, day) + 1) % 7;
      if ((AMBULANCE_WEEKDAYS_BY_DOCTOR_ID[doctorId] ?? []).includes(nextWeekday)) {
        reasons.push('služba je den před ambulancí');
      }
      if (reasons.length > 0) {
        items.push({ day, doctorName: doctor.name, reasons });
      }
    }
    return items;
  }, [result, dayCount, doctors, preferences, year, month]);

  const serviceDatesByDoctor = useMemo(() => {
    const map: Record<number, number[]> = {};
    for (const doctor of doctors) {
      map[doctor.id] = [];
    }
    if (!result || !result.ok) {
      return map;
    }
    for (let day = 1; day <= dayCount; day += 1) {
      const doctorId = result.assignments[day];
      if (doctorId != null) {
        map[doctorId] = [...(map[doctorId] ?? []), day];
      }
    }
    return map;
  }, [result, doctors, dayCount]);

  const mobileResultDays = useMemo(() => {
    const allDays = Array.from({ length: dayCount }, (_, idx) => idx + 1);
    if (!showOnlyProblemDays || problematicDays.length === 0) {
      return allDays;
    }
    const problemSet = new Set(problematicDays.map((item) => item.day));
    return allDays.filter((day) => problemSet.has(day));
  }, [dayCount, showOnlyProblemDays, problematicDays]);
  const problematicDaySet = useMemo(() => new Set(problematicDays.map((item) => item.day)), [problematicDays]);

  const currentState = (): PersistedState => ({
    year: primaryPlan.year,
    month: primaryPlan.month,
    doctors,
    maxShiftsByDoctor,
    targetShiftsByDoctor,
    preferences: primaryPlan.preferences,
    locks: primaryPlan.locks,
    previousMonthLastTwo: primaryPlan.previousMonthLastTwo,
    seed: primaryPlan.seed,
    finalizedAt: primaryPlan.finalizedAt,
    activePlanSlot,
    secondaryPlan: secondaryPlan,
  });

  const applyPersistedState = (next: PersistedState): void => {
    setPrimaryPlan({
      year: next.year,
      month: next.month,
      preferences: next.preferences,
      locks: next.locks,
      previousMonthLastTwo: next.previousMonthLastTwo,
      seed: next.seed,
      finalizedAt: next.finalizedAt,
    });
    setSecondaryPlan(
      next.secondaryPlan ??
        (() => {
          const nextDate = new Date(next.year, next.month, 1);
          return {
            year: nextDate.getFullYear(),
            month: nextDate.getMonth() + 1,
            preferences: {},
            locks: {},
            previousMonthLastTwo: { penultimateDoctorId: null, lastDoctorId: null },
            seed: '',
            finalizedAt: undefined,
          };
        })(),
    );
    setActivePlanSlot(next.activePlanSlot === 2 ? 2 : 1);
    setDoctors(next.doctors);
    setMaxShiftsByDoctor(next.maxShiftsByDoctor);
    setTargetShiftsByDoctor(next.targetShiftsByDoctor);
    setActiveDoctorId(next.doctors[0]?.id ?? 1);
    setResult(null);
    setShowOnlyProblemDays(false);
    saveState(next);
  };

  const loadSavedVersion = (version: SavedScheduleVersion) => {
    const next = version.state;
    setPrimaryPlan({
      year: next.year,
      month: next.month,
      preferences: next.preferences,
      locks: next.locks,
      previousMonthLastTwo: next.previousMonthLastTwo,
      seed: next.seed,
      finalizedAt: next.finalizedAt,
    });
    setSecondaryPlan(
      next.secondaryPlan ??
        (() => {
          const nextDate = new Date(next.year, next.month, 1);
          return {
            year: nextDate.getFullYear(),
            month: nextDate.getMonth() + 1,
            preferences: {},
            locks: {},
            previousMonthLastTwo: { penultimateDoctorId: null, lastDoctorId: null },
            seed: '',
            finalizedAt: undefined,
          };
        })(),
    );
    setActivePlanSlot(next.activePlanSlot === 2 ? 2 : 1);
    setDoctors(next.doctors);
    setMaxShiftsByDoctor(next.maxShiftsByDoctor);
    setTargetShiftsByDoctor(next.targetShiftsByDoctor);
    setActiveDoctorId(next.doctors[0]?.id ?? 1);
    setResult(version.result);
    setShowOnlyProblemDays(false);
    saveState(next);
    setBackupNotice(`Načtena uložená verze: ${version.title}`);
  };

  const saveBackupToDevice = () => {
    saveBackupState(currentState());
    setBackupNotice('Záloha byla uložena do zařízení.');
  };

  const exportBackupFile = async () => {
    const state = currentState();
    const filename = `kalendar-zaloha-${state.year}-${String(state.month).padStart(2, '0')}.json`;
    const jsonContent = JSON.stringify(state, null, 2);
    try {
      const file = new File([jsonContent], filename, { type: 'application/json' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'Záloha kalendáře služeb',
          files: [file],
        });
        setBackupNotice('Záloha připravena ve sdílení (Soubor / Uložit do souborů).');
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setBackupNotice('Sdílení zálohy bylo zrušeno.');
        return;
      }
    }
    downloadJson(jsonContent, filename);
    setBackupNotice('Záloha byla stažena jako soubor JSON.');
  };

  const printSchedule = () => {
    if (!result || !result.ok) {
      setBackupNotice('Nejdřív je potřeba vygenerovat rozpis.');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setBackupNotice('Pro tisk povolte otevírání nových oken pro tuto stránku.');
      return;
    }

    const rows = Array.from({ length: dayCount }, (_, idx) => {
      const day = idx + 1;
      const doctorName = doctors.find((d) => d.id === result.assignments[day])?.name ?? '—';
      const weekdayLabel = WEEKDAY_SHORT[weekdayMondayIndex(year, month, day)];
      return `<tr><td>${day}</td><td>${weekdayLabel}</td><td>${escapeHtml(doctorName)}</td></tr>`;
    }).join('');

    printWindow.document.write(`<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rozpis služeb</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 16px; color: #0f172a; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
    th { background: #f1f5f9; }
    @media print { body { margin: 10mm; } }
  </style>
</head>
<body>
  <h1>Služby – ${escapeHtml(CZECH_MONTHS[month - 1])} ${year}</h1>
  <table>
    <thead>
      <tr><th>Den</th><th>Týden</th><th>Lékař</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 200);
    };
  </script>
</body>
</html>`);
    printWindow.document.close();
  };

  const restoreBackupFromDevice = () => {
    const backup = loadBackupState();
    if (!backup) {
      setBackupNotice('V zařízení nebyla nalezena žádná záloha.');
      return;
    }
    applyPersistedState(backup);
    setBackupNotice('Poslední záloha byla načtena.');
  };

  const importBackupFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    const text = await file.text();
    const parsed = parseStateFromJson(text);
    if (!parsed) {
      setBackupNotice('Soubor se nepodařilo načíst. Zkontrolujte, že jde o platnou zálohu JSON.');
      return;
    }
    applyPersistedState(parsed);
    saveBackupState(parsed);
    setBackupNotice('Záloha ze souboru byla načtena.');
  };

  useEffect(() => {
    if (!result || result.ok || !result.partialProposal) {
      setDebateSelectionByDay({});
      return;
    }

    const nextSelection: Record<number, number> = {};
    for (const entry of result.partialProposal.unassignedDays) {
      if (entry.candidateDoctorIds.length > 0) {
        nextSelection[entry.day] = entry.candidateDoctorIds[0];
      }
    }
    setDebateSelectionByDay(nextSelection);
  }, [result]);

  useEffect(() => {
    if (!result || !result.ok) {
      setShowOnlyProblemDays(false);
    }
  }, [result]);

  useEffect(() => {
    if (!result || !result.ok) {
      setResultSelectionByDay({});
      return;
    }
    const next: Record<number, number> = {};
    for (let day = 1; day <= dayCount; day += 1) {
      next[day] = result.assignments[day];
    }
    setResultSelectionByDay(next);
  }, [result, dayCount]);

  const applyDebateChoiceAndRecalculate = (day: number) => {
    const selectedDoctorId = debateSelectionByDay[day];
    if (!selectedDoctorId) {
      return;
    }
    if (!confirmLockForDay(day, selectedDoctorId)) {
      return;
    }
    const nextLocks = {
      ...locks,
      [day]: selectedDoctorId,
    };
    setLocks(nextLocks);
    runGenerationWithLocks(nextLocks);
  };

  const lockAllFromCurrentResult = () => {
    if (!result || !result.ok) {
      return;
    }
    const nextLocks: Record<number, number | null> = { ...locks };
    for (let day = 1; day <= dayCount; day += 1) {
      nextLocks[day] = result.assignments[day];
    }
    setLocks(nextLocks);
    runGenerationWithLocks(nextLocks);
    setBackupNotice('Všechny dny z aktuálního rozpisu byly zamčeny.');
  };

  const unlockAllDays = () => {
    const nextLocks: Record<number, number | null> = {};
    setLocks(nextLocks);
    runGenerationWithLocks(nextLocks);
    setBackupNotice('Všechna zamčení byla zrušena.');
  };

  const unlockDay = (day: number) => {
    const nextLocks: Record<number, number | null> = { ...locks };
    delete nextLocks[day];
    setLocks(nextLocks);
    setBackupNotice(`Den ${day} byl odemčen.`);
  };

  const finalizeCurrentSchedule = () => {
    if (!result || !result.ok) {
      setBackupNotice('Nejdřív je potřeba vygenerovat rozpis.');
      return;
    }
    const confirmed = window.confirm('Označit tento rozpis jako finální?');
    if (!confirmed) {
      return;
    }

    const finalizedAt = new Date().toISOString();
    setActivePlan((prev) => ({ ...prev, finalizedAt }));

    if (activePlanSlot === 1) {
      const penultimateDoctorId = dayCount >= 2 ? result.assignments[dayCount - 1] ?? null : null;
      const lastDoctorId = result.assignments[dayCount] ?? null;
      setSecondaryPlan((prev) => ({
        ...prev,
        previousMonthLastTwo: {
          penultimateDoctorId,
          lastDoctorId,
        },
      }));
      setBackupNotice('Rozpis je finální. Poslední 2 služby byly propsány do dalšího měsíce.');
      return;
    }

    setBackupNotice('Rozpis je označen jako finální.');
  };

  const unsetFinalizedSchedule = () => {
    setActivePlan((prev) => ({ ...prev, finalizedAt: undefined }));
    setBackupNotice('Finální stav byl zrušen, rozpis lze dál upravovat.');
  };

  const primarySlotLabel = `${CZECH_MONTHS[primaryPlan.month - 1]} ${primaryPlan.year}`;
  const secondarySlotLabel = `${CZECH_MONTHS[secondaryPlan.month - 1]} ${secondaryPlan.year}`;
  const finalizedMonthHistory = useMemo(() => {
    return savedVersions
      .flatMap((version) => {
        if (!version.state.finalizedAt || !version.result || !version.result.ok) {
          return [];
        }
        const versionDayCount = daysInMonth(version.state.year, version.state.month);
        const assignments = version.result.assignments;
        return {
          id: version.id,
          label: `${CZECH_MONTHS[version.state.month - 1]} ${version.state.year}`,
          penultimateDoctorId: versionDayCount >= 2 ? assignments[versionDayCount - 1] ?? null : null,
          lastDoctorId: assignments[versionDayCount] ?? null,
          createdAt: version.createdAt,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [savedVersions]);

  return (
    <div className="mx-auto max-w-[1200px] overflow-x-hidden px-3 py-4 text-slate-900 sm:px-4 sm:py-6">
      <h1 className="mb-4 text-xl font-bold sm:text-2xl">Měsíční přehled sloužících lékařů</h1>

      <div className="no-print mb-6 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setIsExpertMode(false)}
          className={`rounded-xl border px-4 py-3 text-left text-base font-semibold transition ${
            !isExpertMode
              ? 'border-slate-900 bg-gradient-to-r from-slate-900 to-slate-700 text-white shadow'
              : 'border-slate-300 bg-white text-slate-800'
          }`}
        >
          Zadání požadavků a generování
        </button>
        <button
          type="button"
          onClick={() => setIsExpertMode(true)}
          className={`rounded-xl border px-4 py-3 text-left text-base font-semibold transition ${
            isExpertMode
              ? 'border-slate-900 bg-gradient-to-r from-slate-900 to-slate-700 text-white shadow'
              : 'border-slate-300 bg-white text-slate-800'
          }`}
        >
          Pokročilé nastavení
        </button>
      </div>

      <div className="no-print space-y-6">

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">1) Měsíc</h2>
          <div className="flex flex-wrap gap-3">
            <label className="flex w-full items-center gap-2 sm:w-auto">
              <span>Měsíc</span>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                disabled={activePlanSlot === 2}
                className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100 disabled:text-slate-500 sm:flex-none"
              >
                {CZECH_MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full items-center gap-2 sm:w-auto">
              <span>Rok</span>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                disabled={activePlanSlot === 2}
                className="w-full rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100 disabled:text-slate-500 sm:w-28"
              />
            </label>
            {isExpertMode && (
              <label className="flex w-full items-center gap-2 sm:w-auto">
                <span>Seed (volitelný)</span>
                <input
                  type="text"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
                  placeholder="např. pokus-2"
                />
              </label>
            )}
          </div>
          {activePlanSlot === 2 && <p className="mt-2 text-xs text-slate-600">Druhý plán je automaticky navázaný na následující měsíc.</p>}
          {!isExpertMode && <p className="mt-2 text-xs text-slate-600">Pokročilé volby jsou dostupné v záložce Pokročilé nastavení.</p>}
        </section>

        {isExpertMode && (
          <section className="rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">2) Lékaři (fixní pořadí #1–#10)</h2>
              <button
                type="button"
                onClick={() => setShowDoctorsSection((prev) => !prev)}
                className="shrink-0 rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
                aria-expanded={showDoctorsSection}
              >
                {showDoctorsSection ? 'Sbalit' : 'Rozbalit'}
              </button>
            </div>
            {showDoctorsSection && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {doctors.map((doctor) => (
                  <div
                    key={doctor.id}
                    className={`min-w-0 rounded border p-2 ${isCertifiedDoctor(doctor) ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-600">#{doctor.order}</span>
                      <span className="text-[10px] uppercase text-slate-500">{roleLabel(doctor.role)}</span>
                      {isCertifiedDoctor(doctor) && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                          Atest.
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={doctor.name}
                      onChange={(e) => updateDoctorName(doctor.id, e.target.value)}
                      disabled={isFixedNamedDoctor(doctor)}
                      className="mb-2 w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-600"
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="min-w-0 rounded border border-slate-200 bg-white p-2 text-xs">
                        <span className="mb-1 block text-slate-600">Max/měsíc</span>
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => adjustMaxShifts(doctor.id, -1)}
                            disabled={doctor.role === 'primar' || doctor.role === 'zastupce'}
                            className="rounded border border-slate-300 px-2 py-1 leading-none disabled:bg-slate-100 disabled:text-slate-500"
                            aria-label={`Snížit max služeb pro ${doctor.name}`}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={0}
                            value={doctor.role === 'primar' ? 1 : doctor.role === 'zastupce' ? 2 : (maxShiftsByDoctor[doctor.id] ?? 5)}
                            onChange={(e) => updateMaxShifts(doctor.id, e.target.value)}
                            disabled={doctor.role === 'primar' || doctor.role === 'zastupce'}
                            className="w-14 rounded border border-slate-300 px-1 py-1 text-center text-xs disabled:bg-slate-100 disabled:text-slate-500"
                          />
                          <button
                            type="button"
                            onClick={() => adjustMaxShifts(doctor.id, 1)}
                            disabled={doctor.role === 'primar' || doctor.role === 'zastupce'}
                            className="rounded border border-slate-300 px-2 py-1 leading-none disabled:bg-slate-100 disabled:text-slate-500"
                            aria-label={`Zvýšit max služeb pro ${doctor.name}`}
                          >
                            +
                          </button>
                        </div>
                      </label>
                      <label className="min-w-0 rounded border border-slate-200 bg-white p-2 text-xs">
                        <span className="mb-1 block text-slate-600">Požadováno</span>
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => adjustTargetShifts(doctor.id, -1)}
                            className="rounded border border-slate-300 px-2 py-1 leading-none"
                            aria-label={`Snížit požadovaný počet služeb pro ${doctor.name}`}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={0}
                            value={targetShiftsByDoctor[doctor.id] ?? 0}
                            onChange={(e) => updateTargetShifts(doctor.id, e.target.value)}
                            className="w-14 rounded border border-slate-300 px-1 py-1 text-center text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => adjustTargetShifts(doctor.id, 1)}
                            className="rounded border border-slate-300 px-2 py-1 leading-none"
                            aria-label={`Zvýšit požadovaný počet služeb pro ${doctor.name}`}
                          >
                            +
                          </button>
                        </div>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {isExpertMode && (
          <section className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">3) Minulý měsíc – poslední 2 dny</h2>
            <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm sm:w-48">Předposlední den měsíce</span>
              <select
                value={previousMonthLastTwo.penultimateDoctorId ?? ''}
                onChange={(e) =>
                  setPreviousMonthLastTwo((prev) => ({
                    ...prev,
                    penultimateDoctorId: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                className="w-full rounded border border-slate-300 px-2 py-1 sm:flex-1"
              >
                <option value="">Nezadáno</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm sm:w-48">Poslední den měsíce</span>
              <select
                value={previousMonthLastTwo.lastDoctorId ?? ''}
                onChange={(e) =>
                  setPreviousMonthLastTwo((prev) => ({
                    ...prev,
                    lastDoctorId: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                className="w-full rounded border border-slate-300 px-2 py-1 sm:flex-1"
              >
                <option value="">Nezadáno</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Lékař z posledního dne minulého měsíce nemůže sloužit den 1. Po finálním potvrzení se poslední 2 služby propíší automaticky do dalšího měsíce.
            </p>
            <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-800">Načíst poslední služby z uzamčených měsíců</h3>
              {finalizedMonthHistory.length === 0 ? (
                <p className="mt-1 text-xs text-slate-600">Zatím není k dispozici žádný uzamčený měsíc v historii verzí.</p>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {finalizedMonthHistory.map((entry) => {
                    const penultimateName =
                      entry.penultimateDoctorId != null
                        ? doctors.find((doctor) => doctor.id === entry.penultimateDoctorId)?.name ?? `Lékař #${entry.penultimateDoctorId}`
                        : 'Nezadáno';
                    const lastName =
                      entry.lastDoctorId != null
                        ? doctors.find((doctor) => doctor.id === entry.lastDoctorId)?.name ?? `Lékař #${entry.lastDoctorId}`
                        : 'Nezadáno';
                    return (
                      <div key={entry.id} className="rounded border border-slate-200 bg-white p-2">
                        <div className="text-sm font-medium text-slate-800">{entry.label}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          Předposlední: {penultimateName}, poslední: {lastName}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviousMonthLastTwo({
                              penultimateDoctorId: entry.penultimateDoctorId,
                              lastDoctorId: entry.lastDoctorId,
                            })
                          }
                          className="mt-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          Načíst do tohoto měsíce
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {!isExpertMode && (
          <section className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">2) Požadavky a dostupnost</h2>
            <div className="mb-3">
              <button
                type="button"
                onClick={clearCurrentMonthRequirements}
                className="rounded border border-rose-300 bg-rose-50 px-3 py-1 text-sm text-rose-700"
              >
                Smazat všechny požadavky měsíce
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {doctors.map((doctor) => (
                <button
                  key={doctor.id}
                  type="button"
                  onClick={() => setActiveDoctorId(doctor.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    activeDoctor?.id === doctor.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : isCertifiedDoctor(doctor)
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-800'
                  }`}
                >
                  #{doctor.order} {doctor.name}
                </button>
              ))}
            </div>

          <div className="mb-3 grid gap-2 text-xs sm:grid-cols-4">
            {PREF_VALUES.map((value) => {
              return (
                <div key={value} className={`rounded border px-2 py-1 ${PREF_CLASS[value]}`}>
                  {PREF_SHORT[value]} = {PREF_LABELS[value]}
                </div>
              );
            })}
          </div>

          <p className="mb-3 text-sm text-slate-600">
            Aktivní lékař: <span className="font-medium">{activeDoctor?.name}</span>. Kliknutím na den přepínáš stav:
            Bez omezení → Nemůže → Nechce → Chce.
            {activeDoctor && isCertifiedDoctor(activeDoctor) ? ' (Atestovaný)' : ''}
          </p>
            <div className="grid grid-cols-7 gap-1 border border-slate-200 p-1 sm:p-2">
              {WEEKDAY_SHORT.map((d) => (
                <div key={d} className="p-1 text-center text-[10px] font-semibold text-slate-600 sm:p-2 sm:text-xs">
                  {d}
                </div>
              ))}
              {cells.map((cell, idx) => {
                if (!cell.day || !activeDoctor) {
                  return (
                    <div key={idx} className="relative min-h-14 rounded bg-slate-50 sm:min-h-20">
                      {cell.nextMonthDay != null && (
                        <div className="absolute right-1 top-1 text-[10px] text-slate-400 sm:text-xs">{cell.nextMonthDay}.</div>
                      )}
                    </div>
                  );
                }
                const day = cell.day;
                const pref = (preferences[activeDoctor.id]?.[day] ?? 0) as PreferenceValue;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPref(activeDoctor.id, day)}
                    className={`min-h-14 rounded border p-1 text-left ${PREF_CLASS[pref]} sm:min-h-20 sm:p-2`}
                    title={`${activeDoctor.name}: ${PREF_LABELS[pref]}`}
                  >
                    <div className="text-[10px] font-semibold sm:text-xs">{day}</div>
                    <div className="mt-1 text-[10px] leading-tight sm:text-xs">{PREF_SHORT[pref]}</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {!isExpertMode && (
          <section className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">3) Generování</h2>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={runGeneration}
                className="w-full rounded bg-slate-900 px-4 py-2 text-white sm:w-auto"
              >
                Generovat rozpis
              </button>
            </div>
          </section>
        )}

      </div>

      {!isExpertMode && (
        <section
          className={`mt-6 rounded-lg p-4 shadow-sm print:shadow-none ${
            activePlan.finalizedAt ? 'border border-emerald-300 bg-emerald-50' : 'bg-white'
          }`}
        >
        <h2 className="mb-2 text-xl font-semibold">
          Služby – {CZECH_MONTHS[month - 1]} {year}
        </h2>
        {!result && <p className="text-slate-600">Rozpis zatím nebyl vygenerován.</p>}

        {result && !result.ok && (
          <div>
            <p className="mb-2 font-semibold text-rose-700">Rozpis nelze vytvořit.</p>
            <ul className="list-disc pl-5 text-sm text-rose-700">
              {result.conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="no-print mt-3">
              <button
                type="button"
                onClick={runGeneration}
                className="rounded border border-rose-300 bg-rose-50 px-3 py-1 text-sm text-rose-700"
              >
                Zkusit znovu
              </button>
            </div>
            {result.partialProposal && (
              <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">Návrh k debatě (s neobsazenými dny)</p>
                <ul className="mt-2 space-y-2 text-sm text-amber-900">
                  {result.partialProposal.unassignedDays.length === 0 && (
                    <li>V návrhu nevznikly neobsazené dny.</li>
                  )}
                  {result.partialProposal.unassignedDays.map((entry) => {
                    const candidateNames = entry.candidateDoctorIds
                      .map((id) => doctors.find((doctor) => doctor.id === id)?.name)
                      .filter((name): name is string => Boolean(name));
                    return (
                      <li key={entry.day} className="rounded border border-amber-300 bg-white p-2">
                        <div>
                          Den {entry.day} zůstal neobsazený.
                          {candidateNames.length > 0
                            ? ` Možní kandidáti k debatě: ${candidateNames.join(', ')}.`
                            : ' Pro tento den teď není kandidát, který by splnil pravidla.'}
                        </div>
                        {entry.candidateDoctorIds.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select
                              value={debateSelectionByDay[entry.day] ?? entry.candidateDoctorIds[0]}
                              onChange={(e) =>
                                setDebateSelectionByDay((prev) => ({
                                  ...prev,
                                  [entry.day]: Number(e.target.value),
                                }))
                              }
                              className="rounded border border-amber-300 bg-white px-2 py-1 text-sm"
                            >
                              {entry.candidateDoctorIds.map((doctorId) => {
                                const doctor = doctors.find((d) => d.id === doctorId);
                                return (
                                  <option key={doctorId} value={doctorId}>
                                    {doctor?.name ?? `Lékař ${doctorId}`}
                                  </option>
                                );
                              })}
                            </select>
                            <button
                              type="button"
                              onClick={() => applyDebateChoiceAndRecalculate(entry.day)}
                              className="rounded border border-amber-400 bg-amber-100 px-2 py-1 text-sm text-amber-900"
                            >
                              Vybrat a dopočítat
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

            {result && result.ok && (
          <>
            <div className="no-print mb-4 flex flex-wrap gap-3">
              {!isExpertMode && (
                <button
                  type="button"
                  onClick={runGeneration}
                  className="w-full rounded bg-slate-900 px-4 py-2 text-white sm:w-auto"
                >
                  Vygenerovat znovu
                </button>
              )}
              {!isExpertMode && (
                <button
                  type="button"
                  onClick={finalizeCurrentSchedule}
                  className="w-full rounded bg-emerald-600 px-4 py-2 text-white sm:w-auto"
                >
                  Označit jako finální
                </button>
              )}
              {!isExpertMode && (
                <button
                  type="button"
                  onClick={unsetFinalizedSchedule}
                  className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
                >
                  Zrušit finální stav
                </button>
              )}
              {(isExpertMode || (activePlanSlot === 1 && Boolean(activePlan.finalizedAt))) && (
                <button
                  type="button"
                  onClick={printSchedule}
                  className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
                >
                  Tisk A4
                </button>
              )}
              {(isExpertMode || (activePlanSlot === 1 && Boolean(activePlan.finalizedAt))) && (
                <button
                  type="button"
                  onClick={exportCsv}
                  className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
                >
                  Export CSV
                </button>
              )}
              {isExpertMode && (
                <button
                  type="button"
                  onClick={lockAllFromCurrentResult}
                  className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
                >
                  Zamknout vše z rozpisu
                </button>
              )}
              {isExpertMode && (
                <button
                  type="button"
                  onClick={unlockAllDays}
                  className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
                >
                  Odemknout vše
                </button>
              )}
              {activePlan.finalizedAt && (
                <span className="text-sm font-medium text-emerald-700">
                  Finální potvrzení: {new Date(activePlan.finalizedAt).toLocaleString('cs-CZ')}
                </span>
              )}
            </div>
            {generationNotice && <p className="no-print mb-3 text-sm text-slate-700">{generationNotice}</p>}
            <div className="mb-4">
              <div className="rounded border border-rose-300 bg-rose-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-rose-900">Problémové dny</p>
                  <label className="flex items-center gap-2 text-sm sm:hidden">
                    <input
                      type="checkbox"
                      checked={showOnlyProblemDays}
                      onChange={(e) => setShowOnlyProblemDays(e.target.checked)}
                    />
                    Jen problémové dny
                  </label>
                </div>
                {problematicDays.length === 0 ? (
                  <p className="mt-1 text-sm text-emerald-700">Bez problémových dnů podle měkkých pravidel.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-rose-900">
                    {problematicDays.map((item) => (
                      <li key={item.day}>
                        Den {item.day} ({weekdayShortForDay(item.day)}) - {item.doctorName}: {item.reasons.join(', ')}.
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="space-y-2 sm:hidden">
              {mobileResultDays.map((day) => {
                const assignedDoctor = doctors.find((d) => d.id === result.assignments[day]);
                const isCertified = assignedDoctor ? isCertifiedDoctor(assignedDoctor) : false;
                const isLocked = locks[day] != null;
                const isSoftLock = isSoftWantLockedDay(day);
                const controlsDisabled = isLocked && !isSoftLock;
                return (
                  <div
                    key={day}
                    className={`rounded border p-3 ${
                      isLocked
                        ? 'border-emerald-400 bg-emerald-50'
                        : problematicDaySet.has(day)
                        ? 'border-rose-300 bg-rose-50'
                        : weekdayShortForDay(day) === 'So' || weekdayShortForDay(day) === 'Ne'
                          ? 'border-slate-300 bg-slate-50'
                          : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-700">
                        {weekdayShortForDay(day)} {day}.
                      </div>
                      {isLocked && (
                        <div className="text-xs font-medium text-emerald-700">
                          {isSoftLock ? 'Auto-zamčeno (Chce)' : 'Zamčeno'}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-base font-medium">{assignedDoctor?.name ?? '—'}</span>
                      {isCertified && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                          Atestovaný
                        </span>
                      )}
                    </div>
                    <div className="no-print mt-2">
                      <div className={`flex flex-col gap-1 ${isLocked ? 'opacity-60' : ''}`}>
                        <select
                          value={resultSelectionByDay[day] ?? result.assignments[day]}
                          onChange={(e) =>
                            setResultSelectionByDay((prev) => ({
                              ...prev,
                              [day]: Number(e.target.value),
                            }))
                          }
                          disabled={controlsDisabled}
                          className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          {doctors.map((doctor) => (
                            <option key={doctor.id} value={doctor.id}>
                              {doctor.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => applyResultDayChangeAndRecalculate(day)}
                          disabled={controlsDisabled}
                          className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          {isSoftLock ? 'Upravit a dopočítat' : 'Zamknout a dopočítat'}
                        </button>
                      </div>
                      {isLocked && (
                        <button
                          type="button"
                          onClick={() => unlockDay(day)}
                          className="mt-1 rounded border border-emerald-400 bg-white px-2 py-1 text-xs text-emerald-700"
                        >
                          Odemknout den
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden grid-cols-7 gap-1 border border-slate-200 p-1 text-xs sm:grid sm:p-2 sm:text-sm">
                {WEEKDAY_SHORT.map((d) => (
                  <div key={d} className="p-1 text-center font-semibold sm:p-2">
                    {d}
                  </div>
                ))}
                {cells.map((cell, idx) => (
                  <div
                    key={idx}
                    className={`min-h-20 border p-1 sm:min-h-24 sm:p-2 ${
                      cell.day && locks[cell.day] != null
                        ? 'border-emerald-400 bg-emerald-50'
                        : cell.day && problematicDaySet.has(cell.day)
                          ? 'border-rose-300 bg-rose-50'
                          : 'border-slate-100'
                    }`}
                  >
                    {cell.day &&
                      (() => {
                        const day = cell.day;
                        const isLocked = locks[day] != null;
                        const isSoftLock = isSoftWantLockedDay(day);
                        const controlsDisabled = isLocked && !isSoftLock;
                        return (
                          <>
                            <div className="text-[10px] font-semibold text-slate-600 sm:text-xs">{day}</div>
                            <div className="mt-1 truncate text-[10px] leading-tight sm:text-sm">
                              {doctors.find((d) => d.id === result.assignments[day])?.name ?? '—'}
                            </div>
                            <div className="no-print mt-2">
                              <div className={`flex flex-col gap-1 ${isLocked ? 'opacity-60' : ''}`}>
                                <select
                                  value={resultSelectionByDay[day] ?? result.assignments[day]}
                                  onChange={(e) =>
                                    setResultSelectionByDay((prev) => ({
                                      ...prev,
                                      [day]: Number(e.target.value),
                                    }))
                                  }
                                  disabled={controlsDisabled}
                                  className="rounded border border-slate-300 px-1 py-1 text-[10px] sm:text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                                >
                                  {doctors.map((doctor) => (
                                    <option key={doctor.id} value={doctor.id}>
                                      {doctor.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => applyResultDayChangeAndRecalculate(day)}
                                  disabled={controlsDisabled}
                                  className="rounded border border-slate-300 px-1 py-1 text-[10px] sm:text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                                >
                                  {isSoftLock ? 'Upravit a dopočítat' : 'Zamknout a dopočítat'}
                                </button>
                              </div>
                              {isLocked && (
                                <button
                                  type="button"
                                  onClick={() => unlockDay(day)}
                                  className="mt-1 rounded border border-emerald-400 bg-white px-1 py-1 text-[10px] text-emerald-700 sm:text-xs"
                                >
                                  Odemknout den
                                </button>
                              )}
                            </div>
                            {isLocked && (
                              <div className="mt-1 text-xs font-medium text-emerald-700">
                                {isSoftLock ? 'Auto-zamčeno (Chce): ' : 'Zamčeno: '}
                                {doctors.find((d) => d.id === locks[day])?.name}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    {!cell.day && cell.nextMonthDay != null && (
                      <div className="text-right text-[10px] text-slate-400 sm:text-xs">{cell.nextMonthDay}.</div>
                    )}
                  </div>
                ))}
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-lg font-semibold">Statistiky</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { title: 'Atestovaní', doctors: doctors.filter((doctor) => isCertifiedDoctor(doctor)) },
                  { title: 'Neatestovaní', doctors: doctors.filter((doctor) => !isCertifiedDoctor(doctor)) },
                ].map((group) => (
                  <div key={group.title} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                    <p className="mb-1 font-semibold text-slate-700">{group.title}</p>
                    <div className="space-y-1">
                      {group.doctors.map((doctor) => {
                        const actual = result.stats.totalByDoctor[doctor.id] ?? 0;
                        const target = targetShiftsByDoctor[doctor.id] ?? 0;
                        const weekend = result.stats.weekendByDoctor[doctor.id] ?? 0;
                        const diff = actual - target;
                        const diffText = diff === 0 ? '0' : diff > 0 ? `+${diff}` : String(diff);
                        const diffClass =
                          diff === 0 ? 'text-emerald-700 bg-emerald-50' : diff > 0 ? 'text-amber-700 bg-amber-50' : 'text-rose-700 bg-rose-50';
                        return (
                          <div key={doctor.id} className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1">
                            <span className="min-w-24 font-semibold text-slate-800">{doctor.name}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">P: {target}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">R: {actual}</span>
                            <span className={`rounded px-2 py-0.5 ${diffClass}`}>Δ {diffText}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">V: {weekend}</span>
                            {isExpertMode && (
                              <div className="text-xs text-slate-700">
                                Datumy služeb:{' '}
                                {serviceDatesByDoctor[doctor.id] && serviceDatesByDoctor[doctor.id].length > 0
                                  ? serviceDatesByDoctor[doctor.id].join(', ')
                                  : '—'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-500">
                Vygenerováno: {new Date().toLocaleString('cs-CZ')}
                {result.seedUsed ? ` | seed: ${result.seedUsed}` : ''}
              </p>
            </div>
          </>
        )}
        </section>
      )}

      {isExpertMode && (
        <section className="no-print mt-6 rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Zálohy a Obnova</h2>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveBackupToDevice}
              className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
            >
              Uložit zálohu (zařízení)
            </button>
            <button
              type="button"
              onClick={restoreBackupFromDevice}
              className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
            >
              Obnovit poslední zálohu
            </button>
            <button
              type="button"
              onClick={exportBackupFile}
              className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
            >
              Stáhnout zálohu (JSON)
            </button>
            <button
              type="button"
              onClick={() => backupFileInputRef.current?.click()}
              className="w-full rounded bg-slate-200 px-4 py-2 sm:w-auto"
            >
              Načíst zálohu (JSON)
            </button>
            <input
              ref={backupFileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                await importBackupFile(e.target.files?.[0] ?? null);
                e.currentTarget.value = '';
              }}
            />
          </div>
          {backupNotice && <p className="mt-3 text-sm text-slate-600">{backupNotice}</p>}
        </section>
      )}

      {isExpertMode && (
        <section className="no-print mt-6 rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Uložené Verze</h2>
          {savedVersions.length === 0 ? (
            <p className="text-sm text-slate-600">Zatím nejsou uložené žádné verze.</p>
          ) : (
            <div className="space-y-2">
              {savedVersions.map((version) => (
                <div
                  key={version.id}
                  className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="text-sm text-slate-700">
                    <div className="font-medium text-slate-800">{version.title}</div>
                    <div>Uloženo: {new Date(version.createdAt).toLocaleString('cs-CZ')}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadSavedVersion(version)}
                    className="rounded border border-slate-300 bg-white px-3 py-1 text-sm"
                  >
                    Načíst verzi
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
