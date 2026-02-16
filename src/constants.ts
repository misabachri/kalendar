import type { Doctor } from './types';

export const STORAGE_KEY = 'kalendar-sluzeb-v1';

export const DEFAULT_DOCTORS: Doctor[] = [
  { id: 1, order: 1, name: 'Primář', role: 'primar' },
  { id: 2, order: 2, name: 'Zástupce', role: 'zastupce' },
  { id: 3, order: 3, name: 'Lékař 3', role: 'regular' },
  { id: 4, order: 4, name: 'Lékař 4', role: 'regular' },
  { id: 5, order: 5, name: 'Lékař 5', role: 'regular' },
  { id: 6, order: 6, name: 'Lékař 6', role: 'regular' },
  { id: 7, order: 7, name: 'Lékař 7', role: 'regular' },
  { id: 8, order: 8, name: 'Lékař 8', role: 'regular' },
  { id: 9, order: 9, name: 'Lékař 9', role: 'regular' },
  { id: 10, order: 10, name: 'Lékař 10', role: 'regular' },
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
