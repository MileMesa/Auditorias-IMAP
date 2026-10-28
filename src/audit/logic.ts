import type { AuditModel, AuditRecord, AuditSection, CategoryResult, Criterion, CriterionResult, Mark, ScoringRule, SectionResult } from './types';

const MARK_FIELD: Record<Mark, 'cumple' | 'noCumple' | 'noAplica'> = { C: 'cumple', NC: 'noCumple', NA: 'noAplica' };

function compliance(counts: Pick<CriterionResult, 'cumple' | 'noCumple' | 'noAplica'>, scoring: ScoringRule): number | null {
  const numerator = counts[MARK_FIELD[scoring.numerator]];
  const denominator = scoring.denominatorMarks.reduce((sum, mark) => sum + counts[MARK_FIELD[mark]], 0);
  return denominator ? (numerator / denominator) * 100 : null;
}

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

function summarizeCriteria(criteria: Criterion[], records: AuditRecord[], scoring: ScoringRule): CriterionResult[] {
  return criteria.map((criterion) => {
    let cumple = 0;
    let noCumple = 0;
    let noAplica = 0;
    let pendientes = 0;
    records.forEach((record) => {
      const mark = record.marks[criterion.id];
      if (mark === 'C') cumple += 1;
      else if (mark === 'NC') noCumple += 1;
      else if (mark === 'NA') noAplica += 1;
      else pendientes += 1;
    });
    return { criterion, cumple, noCumple, noAplica, pendientes, compliance: compliance({ cumple, noCumple, noAplica }, scoring) };
  });
}

export function summarizeSection(section: AuditSection, scoring: ScoringRule): SectionResult {
  const criteriaIds = section.criteria.map((criterion) => criterion.id);
  const records = section.records.filter(hasRecordData);
  const criteria = summarizeCriteria(section.criteria, records, scoring);
  const cumple = criteria.reduce((sum, item) => sum + item.cumple, 0);
  const noCumple = criteria.reduce((sum, item) => sum + item.noCumple, 0);
  const noAplica = criteria.reduce((sum, item) => sum + item.noAplica, 0);
  const totalMarks = cumple + noCumple + noAplica;
  const categoriesByName = new Map<string, CriterionResult[]>();
  criteria.forEach((item) => {
    const category = item.criterion.category?.trim() || 'Sin clasificación';
    categoriesByName.set(category, [...(categoriesByName.get(category) ?? []), item]);
  });
  const categories: CategoryResult[] = [...categoriesByName].map(([category, items]) => {
    const categoryCumple = items.reduce((sum, item) => sum + item.cumple, 0);
    const categoryNoCumple = items.reduce((sum, item) => sum + item.noCumple, 0);
    const categoryNoAplica = items.reduce((sum, item) => sum + item.noAplica, 0);
    const categoryPending = items.reduce((sum, item) => sum + item.pendientes, 0);
    return {
      category,
      criteriaCount: items.length,
      cumple: categoryCumple,
      noCumple: categoryNoCumple,
      noAplica: categoryNoAplica,
      pendientes: categoryPending,
      compliance: compliance({ cumple: categoryCumple, noCumple: categoryNoCumple, noAplica: categoryNoAplica }, scoring),
    };
  });
  const completeCases = records.filter((record) => isRecordComplete(record, criteriaIds)).length;
  return {
    sectionId: section.id,
    sectionName: section.name,
    recordCapacity: section.records.length,
    cases: records.length,
    completeCases,
    incompleteCases: records.length - completeCases,
    totalMarks,
    cumple,
    noCumple,
    noAplica,
    pending: Math.max(records.length * section.criteria.length - totalMarks, 0),
    compliance: compliance({ cumple, noCumple, noAplica }, scoring),
    criteria,
    categories,
  };
}

export function summarizeAudit(audit: AuditModel): SectionResult[] {
  return audit.sections.map((section) => summarizeSection(section, audit.scoring));
}

export function summarizeOverall(results: SectionResult[], scoring: ScoringRule) {
  const counts = {
    cumple: results.reduce((sum, section) => sum + section.cumple, 0),
    noCumple: results.reduce((sum, section) => sum + section.noCumple, 0),
    noAplica: results.reduce((sum, section) => sum + section.noAplica, 0),
  };
  return compliance(counts, scoring);
}

export function setRecordMark(record: AuditRecord, criterionId: string, mark: Mark | null): AuditRecord {
  return { ...record, marks: { ...record.marks, [criterionId]: mark } };
}

export function hasAnyCases(audit: AuditModel): boolean {
  return audit.sections.some((section) => summarizeSection(section, audit.scoring).cases > 0);
}

export function auditIsComplete(audit: AuditModel): boolean {
  return audit.sections.every((section) => {
    const active = section.records.filter(hasRecordData);
    return active.length === 0 || active.every((record) => isRecordComplete(record, section.criteria.map((criterion) => criterion.id)));
  }) && hasAnyCases(audit);
}
