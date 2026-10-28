import type { AuditModel, AuditRecord, Mark, Program, ProgramResult } from './types';

export function hasRecordData(record: AuditRecord): boolean {
  return record.errors.length > 0 || Object.values(record.marks).some((mark) => mark !== null);
}

export function isRecordComplete(record: AuditRecord, criterionIds: string[]): boolean {
  return record.errors.length === 0 && criterionIds.length > 0 && criterionIds.every((id) => record.marks[id] !== null);
}

export function getRecordProgress(record: AuditRecord, criterionIds: string[]) {
  const answered = criterionIds.filter((id) => record.marks[id] !== null).length;
  return { answered, total: criterionIds.length, active: hasRecordData(record), complete: isRecordComplete(record, criterionIds) };
}

export function summarizeProgram(audit: AuditModel, program: Program): ProgramResult {
  const criteria = audit.criteria[program];
  const criterionIds = criteria.map((criterion) => criterion.id);
  const records = audit.records[program].filter(hasRecordData);
  let cumple = 0;
  let noCumple = 0;
  let noAplica = 0;
  let completeCases = 0;

  records.forEach((record) => {
    if (isRecordComplete(record, criterionIds)) completeCases += 1;
    Object.values(record.marks).forEach((mark) => {
      if (mark === 'C') cumple += 1;
      else if (mark === 'NC') noCumple += 1;
      else if (mark === 'NA') noAplica += 1;
    });
  });

  const perCriterion = criteria.map((criterion) => {
    let criterionCumple = 0;
    let criterionNoCumple = 0;
    let criterionNoAplica = 0;
    let pendientes = 0;
    records.forEach((record) => {
      const mark = record.marks[criterion.id];
      if (mark === 'C') criterionCumple += 1;
      else if (mark === 'NC') criterionNoCumple += 1;
      else if (mark === 'NA') criterionNoAplica += 1;
      else pendientes += 1;
    });
    const denominator = criterionCumple + criterionNoCumple;
    return {
      criterion,
      cumple: criterionCumple,
      noCumple: criterionNoCumple,
      noAplica: criterionNoAplica,
      pendientes,
      compliance: denominator ? (criterionCumple / denominator) * 100 : null,
    };
  });

  const denominator = cumple + noCumple;
  const totalMarks = cumple + noCumple + noAplica;
  const pending = Math.max(records.length * criteria.length - totalMarks, 0);
  return {
    program,
    cases: records.length,
    completeCases,
    incompleteCases: records.length - completeCases,
    totalMarks,
    cumple,
    noCumple,
    noAplica,
    pending,
    compliance: denominator ? (cumple / denominator) * 100 : null,
    criteria: perCriterion,
  };
}

export function summarizeAudit(audit: AuditModel): Record<Program, ProgramResult> {
  return { DM: summarizeProgram(audit, 'DM'), HTA: summarizeProgram(audit, 'HTA') };
}

export function setRecordMark(record: AuditRecord, criterionId: string, mark: Mark | null): AuditRecord {
  return { ...record, marks: { ...record.marks, [criterionId]: mark } };
}

export function hasAnyCases(audit: AuditModel): boolean {
  return (['DM', 'HTA'] as Program[]).some((program) => summarizeProgram(audit, program).cases > 0);
}

export function auditIsComplete(audit: AuditModel): boolean {
  return (['DM', 'HTA'] as Program[]).every((program) => {
    const active = audit.records[program].filter(hasRecordData);
    return active.length === 0 || active.every((record) => isRecordComplete(record, audit.criteria[program].map((criterion) => criterion.id)));
  }) && hasAnyCases(audit);
}

