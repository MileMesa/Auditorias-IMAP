export type Program = 'DM' | 'HTA';
export type Mark = 'C' | 'NC' | 'NA';
export type View = 'dashboard' | 'audit' | 'report';

export interface Criterion {
  id: string;
  number: string;
  text: string;
  sheetRow: number;
}

export interface AuditRecord {
  slot: number;
  marks: Record<string, Mark | null>;
  errors: string[];
}

export interface AuditModel {
  title: string;
  periodStart: string;
  periodEnd: string;
  samplingMethod: string;
  sourceVersion: string;
  criteria: Record<Program, Criterion[]>;
  records: Record<Program, AuditRecord[]>;
  updatedAt: string;
}

export interface CriterionResult {
  criterion: Criterion;
  cumple: number;
  noCumple: number;
  noAplica: number;
  pendientes: number;
  compliance: number | null;
}

export interface ProgramResult {
  program: Program;
  cases: number;
  completeCases: number;
  incompleteCases: number;
  totalMarks: number;
  cumple: number;
  noCumple: number;
  noAplica: number;
  pending: number;
  compliance: number | null;
  criteria: CriterionResult[];
}

