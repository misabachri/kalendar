export type DoctorRole = 'primar' | 'zastupce' | 'regular';

export interface Doctor {
  id: number;
  order: number;
  name: string;
  role: DoctorRole;
}

export type PreferenceValue = 0 | 1 | 2 | 3;

export interface PreviousMonthLastTwo {
  penultimateDoctorId: number | null;
  lastDoctorId: number | null;
}

export interface ScheduleInput {
  year: number;
  month: number;
  doctors: Doctor[];
  maxShiftsByDoctor: Record<number, number>;
  targetShiftsByDoctor: Record<number, number>;
  preferences: Record<number, Record<number, PreferenceValue>>;
  locks: Record<number, number | null>;
  previousMonthLastTwo: PreviousMonthLastTwo;
  seed?: string;
}

export interface ScheduleStats {
  totalByDoctor: Record<number, number>;
  weekendByDoctor: Record<number, number>;
  friSunPairings: number;
}

export interface RelaxationInfo {
  doctorId: number;
  doctorName: string;
  baseCap: number;
  finalCap: number;
  exceededBy: number;
}

export interface ScheduleSuccess {
  ok: true;
  assignments: Record<number, number>;
  stats: ScheduleStats;
  relaxations: RelaxationInfo[];
  seedUsed?: string;
}

export interface ScheduleFailure {
  ok: false;
  conflicts: string[];
  relaxationsAttempted: RelaxationInfo[];
}

export type ScheduleResult = ScheduleSuccess | ScheduleFailure;
