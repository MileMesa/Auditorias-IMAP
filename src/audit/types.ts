export type Mark = 'C' | 'NC' | 'NA';
export type View = 'dashboard' | 'audit' | 'report';

export interface Criterion {
  id: string;
  number: string;
  text: string;
  sheetRow: number;
  category?: string;
}

export interface AuditRecord {
  slot: number;
  marks: Record<string, Mark | null>;
  errors: string[];
}

export interface AuditSection {
  id: string;
  name: string;
  criteria: Criterion[];
  records: AuditRecord[];
}

export interface ScoringRule {
  numerator: Mark;
  denominatorMarks: Mark[];
  label: string;
}

export interface AuditModel {
  title: string;
  instrumentName: string;
  periodStart: string;
  periodEnd: string;
  samplingMethod: string;
  sourceVersion: string;
  scoring: ScoringRule;
  sections: AuditSection[];
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

export interface CategoryResult {
  category: string;
  criteriaCount: number;
  cumple: number;
  noCumple: number;
  noAplica: number;
  pendientes: number;
  compliance: number | null;
}

export interface SectionResult {
  sectionId: string;
  sectionName: string;
  recordCapacity: number;
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
  categories: CategoryResult[];
}
