import type { Doctor } from './types';

export const STORAGE_KEY = 'kalendar-sluzeb-v1';
export const BACKUP_STORAGE_KEY = 'kalendar-sluzeb-v1-backup';

export const DEFAULT_DOCTORS: Doctor[] = [
  { id: 1, order: 1, name: 'Primář', role: 'primar' },
  { id: 2, order: 2, name: 'Fero (zástupce)', role: 'zastupce' },
  { id: 3, order: 3, name: 'Tom', role: 'regular' },
  { id: 4, order: 4, name: 'Lukáš', role: 'regular' },
  { id: 5, order: 5, name: 'Zdeněk', role: 'regular' },
  { id: 6, order: 6, name: 'Bachri', role: 'regular' },
  { id: 7, order: 7, name: 'Kuba', role: 'regular' },
  { id: 8, order: 8, name: 'Adam', role: 'regular' },
  { id: 9, order: 9, name: 'Pepa', role: 'regular' },
  { id: 10, order: 10, name: 'Radim', role: 'regular' },
];

export const CZECH_MONTHS = [
  'leden',
  'únor',
  'březen',
  'duben',
  'květen',
  'červen',
  'červenec',
  'srpen',
  'září',
  'říjen',
  'listopad',
  'prosinec',
];

export const WEEKDAY_SHORT = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

// JavaScript weekday numbering: 0 = Ne, 1 = Po, ... 6 = So
export const AMBULANCE_WEEKDAYS_BY_DOCTOR_ID: Record<number, number[]> = {
  1: [4], // Primář: čtvrtek
  2: [2], // Fero: úterý
  3: [1], // Tom: pondělí
  4: [4], // Lukáš: čtvrtek
  5: [5], // Zdeněk: pátek
  6: [3], // Bachri: středa
  7: [2], // Kuba: úterý
  8: [],
  9: [5], // Pepa: pátek
  10: [3], // Radim: středa
};
